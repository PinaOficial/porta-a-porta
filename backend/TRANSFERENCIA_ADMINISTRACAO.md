# Transferência e administração — Prompt 21

## Endpoints

```http
POST  /api/vinculos/transferencia
PATCH /api/admin/vinculos/:id/aprovar
GET   /api/admin/vinculos
PATCH /api/admin/vinculos/:id/admin
PATCH /api/admin/usuarios/:id/status
```

A aprovação foi ampliada; sua resposta e o fluxo de aprovação inicial continuam compatíveis. Rotas novas seguem autenticação, Zod, controller, service, repository e Prisma. O roteiro atual fornecido na raiz foi consultado; nenhuma estrutura de banco foi alterada.

## Transferência

`POST /vinculos/transferencia` recebe somente `id_condominio` UUID e `moradia` normalizada com trim, não vazia, de até 80 caracteres. Deriva a pessoa do contexto autenticado, revalida seu vínculo ATIVO no banco e verifica destino existente/ativo, condomínio diferente e ausência de outra PENDENTE. Retorna 201 com ID, condomínio, moradia, status, flag de admin e data de solicitação ISO.

A solicitação cria **ATIVO antigo + PENDENTE novo**. Não altera o vínculo antigo nem os produtos e não bloqueia por pedidos ou por último admin. Duas solicitações concorrentes são serializadas pelo lock do perfil; o índice parcial `one_pending_membership_per_user` continua sendo a garantia adicional, com conflito convertido para `409 MEMBERSHIP_PENDING`.

Na aprovação, outro ATIVO da mesma pessoa agora caracteriza transferência. Admin local deve pertencer ao **destino**; super admin tem autoridade global. A transação revalida PENDENTE, ATIVO antigo e destino ativo. Pedidos SOLICITADO/ACEITO como comprador **ou vendedor** retornam `409 OPEN_ORDERS_BLOCK_TRANSFER`, inclusive para super admin; pedidos terminais não bloqueiam.

Se o vínculo antigo é admin, o aprovador local precisa de outro vínculo ATIVO/admin no condomínio de origem. Sem substituto, recebe `409 LAST_ACTIVE_ADMIN`. Super admin pode intervir nesse bloqueio. O privilégio não é herdado: o novo vínculo inicia `admin_condominio=false`.

Tudo ocorre numa transação `ReadCommitted`: desativar produtos do vínculo antigo, encerrá-lo com `data_fim`, ativar o novo com datas de aprovação/início e ator, e inserir auditoria `APPROVE_MEMBERSHIP`. A metadata identifica `transferencia: true`, os dois vínculos e ATIVO → ENCERRADO. Falhas na troca ou auditoria revertem produtos e ambos os vínculos.

Produtos permanecem associados ao vínculo antigo. Pedidos, preços congelados, históricos de status, conversas, participantes, mensagens e imagens não são movidos nem apagados. A leitura histórica de pedidos/chat continua funcionando após a mudança.

Erros da solicitação: `MEMBERSHIP_REQUIRED` 403 (código já existente para vínculo ativo ausente), `CONDOMINIUM_NOT_FOUND` 404, `CONDOMINIUM_INACTIVE` 409, `SAME_CONDOMINIUM` 409 e `MEMBERSHIP_PENDING` 409. Body/UUID inválidos retornam `VALIDATION_ERROR` 400. O fallback de conflito de único ATIVO continua existindo para corrida de integridade; ele não impede mais o caso normal ATIVO + PENDENTE.

## Estratégia de concorrência

O `POST /pedidos` já mantém `FOR SHARE` nos vínculos do comprador e vendedor até o commit. Nenhuma mudança em seu contrato ou service foi necessária. A transferência obtém `FOR UPDATE` no vínculo antigo **antes** de procurar pedidos abertos:

- Se o pedido obtém seu lock primeiro, a transferência espera. Após o commit, a consulta em ReadCommitted vê o pedido aberto e bloqueia a mudança.
- Se a transferência obtém o lock primeiro, o pedido espera e revalida o vínculo ENCERRADO ao prosseguir: comprador recebe `MEMBERSHIP_REQUIRED`; vendedor, `PRODUCT_UNAVAILABLE`. Nenhuma reserva/pedido parcial é confirmada.

A transferência e a alteração de admin usam um mutex PostgreSQL por condomínio (`pg_advisory_xact_lock` com `hashtextextended(id_condominio, 21)`), adquirido em ordem de UUID quando há origem/destino. Isso serializa a contagem de substitutos com promoções/rebaixamentos e outras transferências. O alvo PENDENTE e o ator local são revalidados depois da espera. Substitutos usados na regra do último admin são mantidos com `FOR SHARE` até o commit. A alteração global da conta usa `FOR UPDATE` na linha do usuário para manter idempotência e auditoria sob chamadas concorrentes.

Os testes sincronizam locks reais nos dois sentidos, como comprador e vendedor; também disputam duas transferências de admins da mesma origem, garantindo que um admin ativo permaneça. Rejeição e suspensão local mantêm seus contratos anteriores; suspensão local continua distinta de encerramento por transferência.

## Administração

`GET /admin/vinculos` aceita `pagina=1`, `limite=20` (máximo 100), `busca`, `status` do enum real e `id_condominio`. Busca por nome/moradia, sem CPF. Admin local usa condomínio derivado do vínculo ativo; filtro diferente retorna 403. Super admin pode consultar globalmente ou filtrar.

A resposta seleciona apenas os campos pedidos, com `morador: { id_usuario, nome_completo }`, datas ISO/null, condomínio e flag administrativa. Não expõe CPF, e-mail ou nascimento. Página e contagem usam o mesmo filtro/snapshot `RepeatableRead`, com relações em lote e ordenação estável por data de solicitação/UUID. **Paginação fica na raiz:**

```json
{ "dados": [], "paginacao": { "pagina": 1, "limite": 20, "total": 0, "total_paginas": 0 } }
```

`PATCH /admin/vinculos/:id/admin` aceita somente boolean real em `admin_condominio`. Exige alvo ATIVO, super admin ou admin ATIVO do mesmo condomínio. Admin local não altera o próprio vínculo (`403 SELF_ADMIN_CHANGE_FORBIDDEN`). Alterações reais gravam `admin_atualizado_por`, `admin_atualizado_em` e auditoria `UPDATE_MEMBERSHIP_ADMIN` com flags anterior/nova, atomicamente. Repetir o valor responde 200 sem mudar timestamp nem duplicar auditoria. A resposta contém ID do vínculo, flag e timestamp administrativo. Ator rebaixado enquanto aguardava perde a autorização ao ser revalidado.

`PATCH /admin/usuarios/:id/status` exige super admin e body estrito com `status_conta: ATIVA|SUSPENSA`. Altera somente `usuario.status_conta` e o timestamp automático do próprio banco, com auditoria `UPDATE_USER_STATUS` e estados anterior/novo. Retorna ID e status; usuário inexistente retorna `404 USER_NOT_FOUND`. Repetição responde 200 sem auditoria duplicada. Não cria/remove super admin, não altera Supabase Auth, vínculos, produtos ou pedidos. A API bloqueia o mesmo token já emitido nas requisições seguintes à suspensão. Reativar a conta não reativa vínculos SUSPENSO/ENCERRADO.

## Arquivos

- `modules/vinculos`: schema/controller/routes/model da solicitação, ampliação do service de aprovação e queries de locks, transferência, listagem e privilégio local no repository.
- `modules/administracao`: schemas/DTOs, controllers e service de listagem/privilégio; routes conectam também a alteração global da conta.
- `modules/usuarios`: schema/model e service/repository para o status global.
- `condominio.repository.ts`, `produto.repository.ts`, `pedido.repository.ts`: consulta do destino, desativação em lote e procura de pedidos abertos, respectivamente. As operações anteriores foram preservadas.
- Auditoria reutiliza `auditoria.repository.ts`, sem criar estrutura ou endpoint adicional.
- `tests/admin-vinculo.test.ts` e `tests/aprovar-vinculo.integration.test.ts`: validação, autorização, privacidade, transferência, matriz de bloqueios, concorrência, idempotência e rollback. Apenas o teste antigo que proibia ATIVO + PENDENTE foi atualizado para o novo comportamento solicitado.

## Validação

- **29 scripts existentes passaram, 462 testes: 162 unitários e 300 de integração.** As suítes ampliadas têm 10 testes unitários administrativos e 45 de integração de aprovação/administração, incluindo os testes anteriores de aprovação inicial.
- **TypeScript strict passou**, incluindo backend e testes via `tsc -p tsconfig.test.json`, executado pelos scripts. Não existem scripts genéricos `typecheck` ou `test`; não foram criados nem invocados.
- **`npm run build`: backend compilou.** O build completo continua falhando nos erros preexistentes TS2339 de `ImportMeta.env` em `frontend/src/lib/api.ts:1` e `frontend/src/lib/supabase.ts:3,4`. O frontend não foi alterado.
- **Regressão passou:** onboarding, situação residencial, fila pendente, aprovação/rejeição/suspensão, categorias, produtos/imagens e pedidos/status/chat. Os testes HTTP usam JWT/JWKS simulados e somente PostgreSQL local descartável, com fixtures limpas entre suítes; nenhuma escrita no Supabase do projeto ou alteração de credenciais Auth/Storage.
- **Preservação por SHA-256:** 119 arquivos preexistentes intactos fora dos 20 arquivos de código/testes ampliados, incluindo DDL, Prisma, fontes do frontend, middlewares e manifests/lock. Nenhum SQL novo, migration, dependência nova ou edição manual do schema Prisma. Instância descartável encerrada ao final.

## Exemplos curl

Tokens e UUIDs fictícios. Para aprovar, use o admin do destino ou super admin.

```bash
API='http://localhost:3000/api'
TOKEN_MORADOR='TOKEN_FICTICIO_MORADOR'
TOKEN_ADMIN_DESTINO='TOKEN_FICTICIO_ADMIN_DESTINO'
TOKEN_SUPER_ADMIN='TOKEN_FICTICIO_SUPER_ADMIN'
DESTINO='10000000-0000-4000-8000-000000000001'
NOVO_VINCULO='20000000-0000-4000-8000-000000000001'
USUARIO='30000000-0000-4000-8000-000000000001'

curl -i -X POST "$API/vinculos/transferencia" \
  -H "Authorization: Bearer $TOKEN_MORADOR" -H 'Content-Type: application/json' \
  --data "{\"id_condominio\":\"$DESTINO\",\"moradia\":\"Bloco B - Apto 302\"}"

curl -i -X PATCH "$API/admin/vinculos/$NOVO_VINCULO/aprovar" \
  -H "Authorization: Bearer $TOKEN_ADMIN_DESTINO"

curl -i "$API/admin/vinculos?status=ATIVO&pagina=1&limite=20" \
  -H "Authorization: Bearer $TOKEN_ADMIN_DESTINO"

curl -i -X PATCH "$API/admin/vinculos/$NOVO_VINCULO/admin" \
  -H "Authorization: Bearer $TOKEN_ADMIN_DESTINO" -H 'Content-Type: application/json' \
  --data '{"admin_condominio":true}'

curl -i -X PATCH "$API/admin/usuarios/$USUARIO/status" \
  -H "Authorization: Bearer $TOKEN_SUPER_ADMIN" -H 'Content-Type: application/json' \
  --data '{"status_conta":"SUSPENSA"}'

curl -i -X PATCH "$API/admin/usuarios/$USUARIO/status" \
  -H "Authorization: Bearer $TOKEN_SUPER_ADMIN" -H 'Content-Type: application/json' \
  --data '{"status_conta":"ATIVA"}'
```

O inventário do backend e o próximo passo estão em [INVENTARIO_BACKEND.md](./INVENTARIO_BACKEND.md).
