# Criação transacional de pedido

O ciclo de status e as rotas de chat estão documentados em [CICLO_PEDIDOS_CHAT.md](./CICLO_PEDIDOS_CHAT.md).

A consulta de compras e vendas de todos os vínculos próprios está disponível em `GET /api/pedidos/me`, documentada em [MEUS_PEDIDOS.md](./MEUS_PEDIDOS.md). O POST continua exigindo vínculo ativo e mantém seu contrato transacional.

```http
POST /api/pedidos
Authorization: Bearer <token>
Content-Type: application/json
```

Body aceito, estrito:

```json
{
  "id_produto": "10000000-0000-4000-8000-000000000001",
  "quantidade": 2,
  "hora_combinada": "2099-01-01T09:00:00-03:00"
}
```

Somente esses três campos são aceitos. UUID é normalizado para minúsculas; quantidade deve ser number inteiro entre 1 e 2.147.483.647, sem coerção de string. O limite superior vem de PostgreSQL INTEGER, sem limite comercial adicional. O horário precisa ser ISO 8601 com timezone explícito, validado pelo Zod e convertido em Date. Datas impossíveis e horários locais sem offset retornam 400.

## Arquivos alterados

| Arquivo | Finalidade |
| --- | --- |
| `src/modules/pedidos/pedido.routes.ts` | Registra POST, autenticação, vínculo ativo, validação Zod e controller. |
| `src/modules/pedidos/pedido.controller.ts` | Encaminha body/contexto ao service e responde 201. |
| `src/modules/pedidos/pedido.schema.ts` | Valida os três campos, rejeita campos extras e transforma o horário em instante. |
| `src/modules/pedidos/pedido.model.ts` | DTO derivado da consulta Prisma, com dinheiro em string e horários ISO. |
| `src/modules/pedidos/pedido.service.ts` | Coordena a transação, elegibilidade, reserva, revalidação, valor congelado, histórico e conversa. |
| `src/modules/pedidos/pedido.repository.ts` | Consultas mínimas, bloqueio dos vínculos, UPDATE condicional, insert de pedido e histórico. |
| `src/modules/chat/chat.repository.ts` | Cria conversa e dois participantes com o transaction client recebido, sem rotas ou mensagens. |
| `src/routes/index.ts` | Monta o módulo em `/api/pedidos`. |
| `tests/pedido.test.ts` | Seis testes unitários: schema, limites, timezone, ausência de autoridade e regra temporal inclusiva. |
| `tests/pedido.integration.test.ts` | 24 testes HTTP/PostgreSQL: autorização, elegibilidade, dinheiro, atomicidade e concorrência controlada. |
| `package.json` | Acrescenta `test:pedidos` e `test:pedidos:integration`, seguindo os scripts específicos já existentes. |
| `CRIACAO_PEDIDOS.md` | Documenta contrato, decisões, validação e seis exemplos curl. |

Os caminhos acima são relativos a `backend/`. Não há dependências novas. Os arquivos que eram placeholders foram implementados diretamente nas pastas dos módulos, sem subpastas ou arquitetura paralela.

## Comprador, tenant e elegibilidade

`obterVinculoAtivo` é reutilizado. A rota aceita moradores e admins locais como compradores comuns. Usuário sem vínculo ATIVO, inclusive super admin sem vínculo residencial, recebe o código existente `403 MEMBERSHIP_REQUIRED`; claims forjadas no JWT não concedem privilégios. A autenticação global continua negando conta suspensa.

O ID do vínculo comprador vem exclusivamente de `auth.vinculo_ativo.id_vinculo`. Dentro da transação, o repository relê o vínculo, verifica sua existência/status ATIVO e o service confirma `id_condomino === auth.id_usuario`. O condomínio autoritativo é o dessa linha, sem confiar no condomínio de um contexto antigo ou em campos do frontend.

O produto e seu vínculo vendedor são consultados dentro da transação. Produto inexistente recebe `404 PRODUCT_NOT_FOUND`. Acesso a produto de outro condomínio recebe `403 FORBIDDEN_CROSS_TENANT`, a convenção da vitrine para tentativa explícita de ampliar o tenant. Compra própria pelo mesmo vínculo recebe `409 CANNOT_BUY_OWN_PRODUCT`. Produto inativo ou vendedor sem vínculo ATIVO recebe `409 PRODUCT_UNAVAILABLE`, sem revelar detalhes administrativos.

Categoria ativa não foi adicionada como condição do pedido: a vitrine mantém seu filtro de categorias, e esta operação segue as regras explícitas desta etapa. Produto ativo com categoria inativa pode ser solicitado diretamente se as demais condições forem satisfeitas.

## Concorrência e bloqueios

O service abre uma transação interativa Prisma com `isolationLevel: 'ReadCommitted'`, coerente com os casos de uso de vínculos já existentes. Os repositories recebem exclusivamente seu transaction client.

O repository usa SELECT parametrizado com `FOR SHARE` nas linhas dos vínculos comprador e vendedor. Isso permite leituras/bloqueios compartilhados de pedidos concorrentes e mantém essas linhas estáveis até o término da transação. Uma suspensão que venceu antes do bloqueio é observada pela releitura; uma suspensão posterior espera o término do pedido. O SQL fica no repository porque a API Prisma `findUnique` não oferece essa cláusula. Não há concatenação de entrada não confiável nem mudança estrutural do banco. [Bloqueios de linha no PostgreSQL](https://www.postgresql.org/docs/16/explicit-locking.html).

A reserva usa `produto.updateMany` com:

```ts
where: {
  id_produto,
  id_vinculo_vendedor,
  ativo: true,
  estoque: { gte: quantidade }
}
data: { estoque: { decrement: quantidade } }
```

É obrigatório atualizar exatamente uma linha. A reserva não depende de um `if` sobre uma leitura anterior de estoque. Em Read Committed, um UPDATE que esperou uma alteração concorrente reavalia seu WHERE contra a versão atualizada da linha. Assim, duas requisições por uma unidade final não conseguem ambas reservá-la: uma vence e a outra recebe `409 INSUFFICIENT_STOCK`. O CHECK de estoque não negativo já existente continua como proteção adicional. [Semântica de Read Committed](https://www.postgresql.org/docs/16/transaction-iso.html).

Depois da tentativa de reserva, produto/vendedor são relidos e revalidados. Produto que ficou inativo é tratado como indisponível, em vez de classificar toda falha de UPDATE como falta de estoque. Uma troca inesperada de vínculo vendedor também é recusada. Qualquer erro após o decremento sai de dentro da transação e provoca rollback.

## Preço congelado e horário

A linha do produto permanece bloqueada pelo UPDATE até o commit. O preço é relido **depois da reserva**, ainda na mesma transação, e o total é calculado com `Prisma.Decimal.mul(quantidade)`. Uma atualização de preço que venceu antes da reserva aparece nessa releitura; atualizações posteriores esperam o commit.

`valor_pedido` guarda o total histórico, independente de edições futuras no produto. Não há coluna nova de preço unitário. O total precisa caber em NUMERIC(12,2), até `9999999999.99`; overflow gera `422 ORDER_VALUE_OUT_OF_RANGE` e rollback, sem erro bruto de PostgreSQL. A resposta usa `toFixed(2)`, a convenção monetária dos produtos, sem converter dinheiro para Number.

Um único `horaSolicitacao = new Date()` é capturado no início do caso de uso. Esse mesmo instante valida `hora_combinada >= horaSolicitacao` e preenche `hora_solicitacao`, `ultima_atualizacao`, histórico inicial, conversa e participantes. Horário exatamente igual é permitido, sem antecedência mínima. Horário anterior recebe `422 INVALID_SCHEDULE_TIME` antes da transação. Offset `-03:00` e seu equivalente `Z` representam o mesmo instante; o banco usa TIMESTAMPTZ e a resposta usa ISO UTC.

## Atomicidade, histórico e conversa

As gravações coordenadas pela mesma transação são:

1. Decremento condicional de estoque.
2. Pedido `SOLICITADO`, com comprador do contexto e total congelado.
3. Histórico inicial `null → SOLICITADO`, com usuário comprador como ator, `motivo = null`.
4. Uma conversa `ATIVA` associada ao pedido.
5. Exatamente dois participantes, derivados dos vínculos: usuário comprador e usuário vendedor.

Se qualquer insert falhar, todos os inserts e o decremento são revertidos. A criação usa a unicidade existente de `conversa.id_pedido` e a chave composta dos participantes. Não há mensagem automática, auditoria administrativa, Storage ou chamadas externas durante a criação.

A reserva não muda manualmente preço, ativo, categoria ou imagens. O trigger existente do PostgreSQL atualiza automaticamente `produto.updated_at` ao alterar estoque; esse efeito do esquema também é revertido em rollback. Não há mudança em DDL, migration, schema Prisma, enum ou modelo de dados.

## Resposta

`201 Created`:

```json
{
  "dados": {
    "id_pedido": "20000000-0000-4000-8000-000000000001",
    "id_produto": "10000000-0000-4000-8000-000000000001",
    "quantidade": 2,
    "valor_pedido": "51.80",
    "status_pedido": "SOLICITADO",
    "hora_solicitacao": "2026-10-16T15:00:00.000Z",
    "hora_combinada": "2099-01-01T12:00:00.000Z",
    "ultima_atualizacao": "2026-10-16T15:00:00.000Z",
    "produto": {
      "id_produto": "10000000-0000-4000-8000-000000000001",
      "nome_produto": "Bolo"
    }
  }
}
```

O DTO é montado explicitamente. Não expõe vínculos, usuários, condomínio, CPF, e-mail, data de nascimento ou paths de imagens. Erros inesperados seguem o middleware existente, que registra apenas tipo técnico e responde `500 INTERNAL_ERROR`, sem expor parâmetros ou mensagens brutas do Prisma.

## Erros controlados

| HTTP | Código | Situação |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | Token ausente/inválido. |
| 403 | `MEMBERSHIP_REQUIRED` | Sem vínculo ativo ou vínculo inválido na revalidação transacional. |
| 403 | `ACCOUNT_SUSPENDED` | Conta global suspensa na autenticação. |
| 400 | `VALIDATION_ERROR` | Body inválido, campos extras, quantidade fora do tipo, data sem timezone. |
| 404 | `PRODUCT_NOT_FOUND` | Produto inexistente. |
| 403 | `FORBIDDEN_CROSS_TENANT` | Produto em outro condomínio. |
| 409 | `CANNOT_BUY_OWN_PRODUCT` | Produto do vínculo comprador. |
| 409 | `PRODUCT_UNAVAILABLE` | Produto inativo, vínculo vendedor não ativo ou associação alterada. |
| 409 | `INSUFFICIENT_STOCK` | UPDATE condicional não reservou a quantidade. |
| 422 | `INVALID_SCHEDULE_TIME` | Horário combinado anterior à solicitação. |
| 422 | `ORDER_VALUE_OUT_OF_RANGE` | Total excede NUMERIC(12,2). |

## Validação

Os **29 scripts de testes disponíveis passaram**, incluindo os dois scripts de pedidos acrescentados nesta etapa: **381 testes**, sendo **145 de unidade e 236 de integração HTTP/PostgreSQL**. Todos executam primeiro `tsc -p tsconfig.test.json`; o TypeScript de backend e testes passou em strict. Não há scripts genéricos `typecheck` ou `test`, e eles não foram invocados.

As suítes de pedidos passaram com seis testes unitários e 24 de integração. A regressão também cobriu todas as rotas anteriores de autenticação, condomínios, onboarding, vínculos, administração, categorias, produtos, upload, signed URLs e exclusão de imagens. A disputa pela última unidade resultou em um 201 e um 409; duas solicitações de duas unidades com estoque três deixaram estoque um; dez solicitações disputando três unidades criaram exatamente três pedidos completos.

`npm run build --workspace backend` passou. `npm run build` compilou o backend, mas o build completo continua falhando nos erros preexistentes de `ImportMeta.env` em `frontend/src/lib/api.ts` e `frontend/src/lib/supabase.ts`. O frontend não foi alterado. `npm run dev` iniciou API em `localhost:3000` e Vite em `localhost:5173`, encerrados após a verificação.

A comparação por SHA-256 confirmou que 44 arquivos protegidos examinados permaneceram intactos: DDL/seeds, schema Prisma, fontes do frontend, módulo de produtos, manifest da raiz e lock. O manifest do backend recebeu somente os dois scripts específicos de teste, sem alteração de dependências. Nenhuma migration ou alteração do banco do projeto foi feita. A instância PostgreSQL descartável usada nos testes foi encerrada ao concluir.

Os testes de integração usam Express, JWT/JWKS e PostgreSQL local descartável. Os cenários concorrentes de preço, desativação e suspensão usam uma segunda conexão PostgreSQL e aguardam a requisição alcançar um bloqueio de linha antes de liberar o commit; não dependem apenas de um atraso arbitrário. Rollbacks são verificados provocando violações reais de FK em pedido, histórico, conversa e participantes.

Não foram criadas rotas de listagem, transição de status, mensagens ou frontend. Também não há carrinho, itens de pedido, pagamento, push, limite por horário ou idempotency key.

Na etapa original de criação, o documento `Roteiro_Projeto_de_Software_Preenchido (1).docx` não estava disponível; a implementação seguiu o Prompt 18, o AGENTS.md e o DDL/Prisma atuais. O roteiro foi disponibilizado posteriormente na raiz e consultado na etapa de [Meus Pedidos](./MEUS_PEDIDOS.md), que confirma o acesso ao histórico próprio. Nenhuma regra de documentos antigos foi reintroduzida.

## Exemplos curl

Tokens e UUIDs são fictícios. Substitua por fixtures com as condições indicadas. O horário futuro deve ser ajustado quando necessário. Cada POST válido cria um novo pedido e reserva estoque; não há idempotência adicional nesta etapa.

```bash
API='http://localhost:3000/api/pedidos'
TOKEN='TOKEN_FICTICIO_COMPRADOR_ATIVO'
TOKEN_VENDEDOR='TOKEN_FICTICIO_DONO_DO_PRODUTO'
PRODUTO='10000000-0000-4000-8000-000000000001'
PRODUTO_OUTRO_CONDOMINIO='10000000-0000-4000-8000-000000000002'

# 1. Pedido válido, estoque >= 2: 201; preço 25.90 produz total 51.80.
curl -i -X POST "$API" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"id_produto\":\"$PRODUTO\",\"quantidade\":2,\"hora_combinada\":\"2099-01-01T09:00:00-03:00\"}"

# 2. Fixture com estoque 3: 409 INSUFFICIENT_STOCK, sem efeitos.
curl -i -X POST "$API" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"id_produto\":\"$PRODUTO\",\"quantidade\":4,\"hora_combinada\":\"2099-01-01T12:00:00Z\"}"

# 3. O token pertence ao vendedor do produto: 409 CANNOT_BUY_OWN_PRODUCT.
curl -i -X POST "$API" -H "Authorization: Bearer $TOKEN_VENDEDOR" \
  -H 'Content-Type: application/json' \
  -d "{\"id_produto\":\"$PRODUTO\",\"quantidade\":1,\"hora_combinada\":\"2099-01-01T12:00:00Z\"}"

# 4. Produto de outro condomínio: 403 FORBIDDEN_CROSS_TENANT.
curl -i -X POST "$API" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"id_produto\":\"$PRODUTO_OUTRO_CONDOMINIO\",\"quantidade\":1,\"hora_combinada\":\"2099-01-01T12:00:00Z\"}"

# 5. Horário passado: 422 INVALID_SCHEDULE_TIME.
curl -i -X POST "$API" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"id_produto\":\"$PRODUTO\",\"quantidade\":1,\"hora_combinada\":\"2000-01-01T12:00:00Z\"}"

# 6. Quantidade zero: 400 VALIDATION_ERROR.
curl -i -X POST "$API" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"id_produto\":\"$PRODUTO\",\"quantidade\":0,\"hora_combinada\":\"2099-01-01T12:00:00Z\"}"
```
