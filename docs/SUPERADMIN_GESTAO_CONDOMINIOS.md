# Gestão de condomínios — Prompt 30

Implementação local de 30/10/2026. Complementa o cadastro do [Prompt 29](CONDOMINIOS_SUPERADMIN.md). Contratos HTTP consolidados no [inventário](BACKEND_INVENTARIO.md) e no [handoff](FRONTEND_HANDOFF.md). Evidências e roteiro no [documento de testes](SUPERADMIN_GESTAO_CONDOMINIOS_TESTES.md).

## Contratos encontrados antes da etapa

- `condominio` já continha `id_condominio`, `nome_residencial` (160), `cep` (8 dígitos), `endereco` (255), `ativo` e `created_at`, sem unicidade de nome/CEP, `updated_at` ou coluna de versão. DDL e Prisma concordavam. Nenhuma alteração estrutural foi necessária.
- Existiam `POST /api/admin/condominios`, exclusivo de super com auditoria `CREATE_CONDOMINIUM`, e `GET /api/condominios`, autenticado, somente ativos, busca/paginação 1/20 e máximo 50. Não existia GET administrativo.
- Super é resolvido na tabela, não nas claims; `autenticar` bloqueia conta SUSPENSA. Admin local só administra seu tenant, sem autoridade cadastral global. Auditoria possui ação livre, ator, entidade/ID, condomínio, timestamp e metadata JSON.
- Onboarding verificava destino ativo antes da transação. Transferência verificava dentro, mas sem lock no condomínio. Aprovação de transferência verificava ativo; aprovação residencial inicial não verificava.
- Sessão/vínculo ATIVO do morador, produtos, pedidos e chat não condicionavam acesso a `condominio.ativo`. Super consultando vitrine/detalhe exige seleção de condomínio ativo por contrato anterior. Este último contrato foi preservado.
- A UI de condomínios só consultava ativos e cadastrava. Seletores de onboarding/transferência não têm cache persistente; suas consultas são refeitas ao montar, buscar ou atualizar.

## Decisões e resultado

Inativo significa indisponível para novas solicitações residenciais, transferências de entrada e aprovações. Não apaga/rejeita pendências, suspende pessoas/vínculos, desativa anúncios nem altera pedidos, conversas ou permissões. Moradores já ATIVOS continuam suas operações; transferência de saída para destino ativo segue as regras anteriores de pedidos abertos e último administrador. Rejeição, consulta e suspensão local explicitamente solicitadas continuam autorizadas.

Reativação permite novas entradas e análise das pendências existentes. Não aprova ninguém, restaura suspensões nem concede admin automaticamente. Cadastro e consulta ativa anteriores continuam funcionando. Não há exclusão, fusão, lote, ViaCEP, serviço externo, novo papel, pagamento ou deploy.

## Rotas e DTOs novos

Todas usam `autenticar` + `exigirSuperAdmin`, com autorização adicional no service. Local/morador recebem 403 mesmo com claims forjadas. GET não aceita body; detalhe e PATCH não aceitam query; params são UUIDs normalizados.

| Método | Rota | Entrada | Resposta |
| --- | --- | --- | --- |
| GET | `/api/admin/condominios` | `busca` trim 1..160 opcional; `ativo=true\|false` opcional; `pagina=1`, `limite=20` máximo 50 | 200 `{dados:CondominioAdmin[],paginacao}` |
| GET | `/api/admin/condominios/:id` | UUID | 200 `{dados:CondominioAdmin}` |
| PATCH | `/api/admin/condominios/:id` | `versao` e pelo menos um de nome_residencial/cep/endereco | 200 `{dados:CondominioAdmin}` |
| PATCH | `/api/admin/condominios/:id/status` | `versao`, `ativo` boolean real, `motivo` trim 1..255 | 200 `{dados:CondominioAdmin}` |

`CondominioAdmin` contém somente `id_condominio`, `nome_residencial`, `cep`, `endereco`, `ativo`, `created_at` ISO UTC e `versao` opaca de 64 caracteres hexadecimais. `paginacao` fica na raiz com pagina/limite/total/total_paginas. Omitir ativo inclui os dois estados. Busca literal sem interpretação de `%`/`_`; ordenação nome/UUID ASC; paginação e count usam o mesmo snapshot RepeatableRead. Sem N+1 ou dados pessoais de moradores.

PATCH é estrito: ausente não altera, vazio/null inválido; nome/endereço usam trim e os limites do cadastro, CEP exatamente oito dígitos no servidor. A UI normaliza máscara. Identificadores, estado, autoridade, moradores e datas não são campos cadastrais editáveis. Nome/CEP não recebem unicidade inventada.

Erros: 400 VALIDATION_ERROR; 401 UNAUTHENTICATED; 403 FORBIDDEN/ACCOUNT_SUSPENDED; 404 CONDOMINIO_NOT_FOUND; 409 CONDOMINIUM_UPDATE_CONFLICT; 500 INTERNAL_ERROR sanitizado. Onboarding indisponível preserva 404 CONDOMINIO_NOT_FOUND; transferência/aprovação preservam 409 CONDOMINIUM_INACTIVE, agora também na aprovação inicial. Não houve renomeação dos códigos históricos.

## Versão, transações e concorrência

Para evitar coluna nova, a versão opaca é SHA-256 de `xmin` da linha PostgreSQL e dos campos selecionados. `xmin` permanece interno; não é identificador de domínio nem timestamp. Tokens são para comparação de igualdade em uma edição, não para ordenação ou armazenamento permanente. Após restore/recriação da base, descarte telas antigas e releia. Como `xmin` é um transaction ID finito, a solução pressupõe duração normal de uma edição, não uma versão eterna de arquivo. Referência: [colunas de sistema PostgreSQL](https://www.postgresql.org/docs/17/ddl-system-columns.html).

Escritas administrativas executam ReadCommitted, `SELECT ... FOR UPDATE`, comparação da versão observada, diferenças explícitas, update e auditoria na mesma transação. Edição concorrente, inclusive de outro campo ou estado, invalida a versão antiga. No-op com versão atual não executa UPDATE nem auditoria; repetir com versão antiga é conflito e não inverte estado. Na resposta perdida, reler antes de nova tentativa.

Onboarding agora revalida destino com `FOR SHARE` dentro da mesma transação que cria identidade/perfil/PENDENTE. Solicitação de transferência e aprovação (inicial ou transferência) mantêm `FOR SHARE` do destino até commit. Desativação com `FOR UPDATE` espera entradas anteriores; entradas posteriores esperam e reavaliam o estado confirmado. Locks de vínculo, mutexes administrativos em ordem fixa, reserva de estoque e bloqueios de transferência preexistentes foram mantidos. A mutação cadastral segura só bloqueia uma linha de condomínio, sem tentar adquirir locks residenciais em sentido inverso. Referência: [locks PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html).

O repository `condominio-admin.repository.ts` concentra SQL parametrizado/Prisma e o acesso interno a xmin; o service coordena autorização, conflitos, transação e auditoria. Não há db push, migrate, SQL estrutural ou edição manual de Prisma.

## Auditoria

`UPDATE_CONDOMINIUM`, `ACTIVATE_CONDOMINIUM` e `DEACTIVATE_CONDOMINIUM` usam ator autenticado, entidade condominio, ID alvo, id_condominio e timestamp do banco. Metadata contém `{antes:{campos alterados},depois:{campos alterados}}` e, nas mudanças de estado, `motivo`. Não grava token, versão HTTP ou payload completo. Falha de auditoria reverte toda a alteração. Sem novo endpoint de auditoria ou política inventada para tentativas negadas.

## Interface

`/admin/condominios` permanece protegido por GuardAdmin somenteSuper e acessível via Administração. Agora consulta GET administrativo e mantém criação do Prompt 29. Busca/ativo/pagina ficam na URL. `?editar=UUID` e `?estado=UUID` permitem abrir/recarregar o diálogo pelo ID sem varrer páginas.

Diálogo nativo modal com nome/estado, labels, foco inicial, ciclo por teclado, Escape/cancelar e retorno ao botão de origem quando ele existe. Estado tem confirmação explícita e motivo obrigatório. Formulários reaproveitam Zod/Campo/cliente HTTP; envio parcial na edição, estado desejado na confirmação, trava síncrona e sucesso somente após resposta. Conflito e falha de resultado incerto mantêm rascunho, bloqueiam nova escrita e permitem recarga explícita; recarga substitui o rascunho pelos dados atuais. Validação recuperável preserva inputs.

Listas têm loading/vazio/erro/retry, abortam leituras obsoletas e reconsultam os filtros atuais após alteração. Corrigem página fora do total. Abrir/fechar diálogo não refaz a lista nem remove seu botão de origem. Estado fora do filtro desaparece após sucesso; mensagem confirma a mudança. Sem cache persistente ou retry automático de escrita. Mudança de identidade continua desmontando o escopo privado pelo shell existente.

## Limites de validação

A entrega valida o ambiente local com Auth/JWKS/Storage simulados, inclusive navegador → Express → Prisma → PostgreSQL. Não representa homologação do Supabase remoto, leitor de tela físico, dispositivos físicos ou produção. Histórico da auditoria do MVP permanece em [MVP_AUDITORIA_FINAL.md](MVP_AUDITORIA_FINAL.md); esta etapa não reclassifica toda a aplicação.
