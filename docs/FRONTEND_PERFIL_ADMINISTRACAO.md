# Frontend — Perfil, transferência e administração

Prompt 27, 16/10/2026. Integração de onze métodos/rotas existentes, reutilizando AuthProvider, EstadoUsuarioProvider, apiFetch com Bearer/ApiError, seletor de condomínio, layout, tema e componentes de campo/aviso. Nenhuma dependência ou mudança no backend, banco, Prisma ou contratos auditados.

## Rotas e autorização

| Rota | Acesso e comportamento |
| --- | --- |
| `/perfil` | Identidade própria com onboarding realizado, inclusive sem residência ativa; super com perfil simplificado |
| `/perfil/transferencia` | Condômino ATIVO; solicitação já pendente redireciona ao Perfil sem novo POST |
| `/admin` | Painel compartilhado: admin local ATIVO ou super global |
| `/admin/vinculos/pendentes` | Fila paginada de solicitações |
| `/admin/vinculos` | Gestão paginada de vínculos; ações globais somente para super |

Rotas permitem acesso direto/refresh. Perfil e Administração substituem a navegação desabilitada no shell. A tela de estado residencial também oferece Perfil. Acesso a Vitrine/publicação continua exigindo ATIVO; histórico próprio de pedidos/chat preserva o guard do Prompt 26. Login, onboarding e restauração de sessão permanecem na infraestrutura existente.

GuardAdmin exige super ou `vinculo_ativo.status_vinculo === ATIVO && admin_condominio === true`. Flag de vínculo histórico não autoriza. Admin local recebe seu condomínio do provider, sem seletor livre; requests omitem id_condominio. Uma URL com filtro estrangeiro mostra erro e não consulta a API administrativa. Super tem escopo global por padrão e pode filtrar pelo catálogo autenticado.

Conta global suspensa continua bloqueada pelo provider/guards. Um 403 administrativo retira as listas privadas, volta ao Perfil com orientação e refaz identidade/residência. Se o papel foi perdido, o atalho de administração desaparece; não há tentativa automática em outro condomínio. Conteúdo administrativo tem chave por identidade/papel/vínculo ativo; logout, troca de conta ou residência desmontam o estado anterior. Leituras usam AbortController e descartam respostas antigas.

## Perfil e transferência

Perfil mostra nome, identificação da própria conta, flag de onboarding e e-mail da própria sessão Supabase. Residências mostram condomínio, moradia, status, privilégio do vínculo e datas disponíveis. Não solicita CPF/nascimento/status global nem implementa formulário de edição.

ATIVO, ATIVO + PENDENTE, apenas PENDENTE e último vínculo REJEITADO/SUSPENSO/ENCERRADO têm apresentação explícita. `ultimo_vinculo` é identificado como último registro, sem inventar uma linha do tempo completa. Super recebe identidade global sem residência ou transferência. Pedidos anteriores continuam disponíveis sem ATIVO.

Solicitar transferência exige destino selecionado no catálogo paginado (limite 20) e nova moradia trim 1..80, validados com Zod. O condomínio atual fica desabilitado no seletor. O POST contém somente id_condominio/moradia e uma trava síncrona evita duplo envio. Após 201, navega ao Perfil, refaz os providers e mostra “Transferência solicitada — aguardando aprovação”. Não encerra o vínculo atual nem desativa produtos no cliente.

MEMBERSHIP_PENDING refaz o estado e mostra a solicitação existente. MEMBERSHIP_REQUIRED refaz a residência e retira ações sem autoridade. CONDOMINIUM_NOT_FOUND/CONDOMINIUM_INACTIVE atualizam o catálogo e pedem outra seleção, preservando moradia. SAME_CONDOMINIUM pede outro destino. VALIDATION_ERROR mostra erros de campo. Não há repetição automática de POST por conflito/rede.

## Clients e contratos

Todas as chamadas utilizam o client central; não há fetch paralelo próprio, acesso direto a tabelas ou Storage.

| HTTP | Função e corpo |
| --- | --- |
| GET /api/usuarios/me | consultarMeuUsuario, já no provider; sem query/body |
| GET /api/vinculos/me | consultarSituacaoResidencial, já no provider |
| GET /api/condominios | listarCondominios pelo seletor; busca opcional, pagina/limite 20 |
| POST /api/vinculos/transferencia | solicitarTransferencia; `{ id_condominio, moradia }` |
| GET /api/admin/vinculos/pendentes | listarVinculosPendentes; pagina/limite 20, busca e condomínio opcional para super |
| GET /api/admin/vinculos | listarVinculosAdmin; mesmos filtros mais status real do vínculo |
| PATCH /api/admin/vinculos/:id/aprovar | aprovarVinculo; sem body, nem `{}` |
| PATCH /api/admin/vinculos/:id/rejeitar | rejeitarVinculo; sem body |
| PATCH /api/admin/vinculos/:id/suspender | suspenderVinculo; sem body |
| PATCH /api/admin/vinculos/:id/admin | alterarAdminVinculo; somente `{ admin_condominio: boolean }` |
| PATCH /api/admin/usuarios/:id/status | alterarStatusConta; somente `{ status_conta: ATIVA ou SUSPENSA }` |

Listas preservam `dados[]` e `paginacao` na raiz. A fila usa `morador.id_condomino`, enquanto a gestão geral usa `morador.id_usuario`; os DTOs são distintos. Decisões de vínculo, privilégio e conta também possuem retornos tipados distintos. `admin_atualizado_em` admite null. Não se presume que datas ausentes ou status global existam nos itens da lista.

Busca por nome/moradia recebe trim e até 160 caracteres. Status usa ATIVO/PENDENTE/REJEITADO/SUSPENSO/ENCERRADO. Busca/status/id_condominio/pagina ficam na URL; mudanças de filtro reiniciam página 1. A interface usa 20 por página, dentro do máximo 100 administrativo e 50 do catálogo. Filtros inválidos/repetidos e offset excessivo são rejeitados antes da leitura. Não há paginação em memória nem varredura de todas as páginas. A seleção de condomínio do super pode ser restaurada pelo UUID do filtro na URL; o catálogo permite substituir/limpar a seleção.

## Decisões e concorrência

Aprovar/rejeitar são oferecidos para PENDENTE; suspender e gerenciar privilégio, para ATIVO. Todas as ações pedem confirmação nativa acessível. Local não recebe controle de seu próprio admin_condominio; super pode gerir qualquer vínculo ativo conforme autorização do servidor. Suspensão local explica perda das ações residenciais e preservação de pedidos/chats, sem suspender a conta ou inventar bloqueio do último admin.

Aprovação pode concluir uma transferência; os efeitos transacionais permanecem no servidor. OPEN_ORDERS_BLOCK_TRANSFER e LAST_ACTIVE_ADMIN exibem causas específicas, mantêm o item pendente e não repetem o PATCH. Super pode intervir na regra do último admin, mas não ignora pedidos abertos. Não são buscados pedidos de terceiros nem executados PATCHs auxiliares de produtos/vínculo antigo.

Há trava por vínculo e por identidade durante ação global, com controles desabilitados. Não há remoção otimista. Após 200 ou conflito 404/409, a listagem atual é relida com os filtros atuais; página acima do novo total é corrigida. As duas páginas não mantêm cache persistente: ao alternar fila/lista, a página de destino consulta novamente o servidor. Mutações no próprio ator e negações 403 refazem o estado global e reaplicam guards. Respostas de mutações após desmontagem não atualizam a próxima identidade.

MEMBERSHIP_NOT_FOUND, MEMBERSHIP_NOT_PENDING, MEMBERSHIP_NOT_ACTIVE, MEMBERSHIP_INCONSISTENT e ACTIVE_MEMBERSHIP_ALREADY_EXISTS explicam indisponibilidade/corrida e refazem leitura. FORBIDDEN/FORBIDDEN_CROSS_TENANT/SELF_ADMIN_CHANGE_FORBIDDEN retornam ao Perfil e revalidam autoridade. VALIDATION_ERROR mostra detalhes recebidos. ACCOUNT_SUSPENDED/UNAUTHENTICATED continuam no tratamento central; rede/conflito não repetem escrita automaticamente. Mantém-se a política limitada preexistente de renovação após 401.

## Conta global e vínculo local

Somente super vê “Suspender conta” e “Reativar conta”, dentro da lista geral. O ID usado é `morador.id_usuario`, nunca o ID do vínculo ou campo inexistente da fila. A UI não inventa toggle ou status inicial: o resultado do PATCH é identificado como última alteração confirmada nesta sessão da tela. Estado e bloqueio de envio são compartilhados por usuário entre vínculos repetidos.

A confirmação de suspensão explica bloqueio de futuras chamadas protegidas mesmo com JWT válido. Reativação libera somente a conta global e não reativa vínculos. Nenhum desses PATCHs altera dados residenciais, produtos, pedidos, chat ou Auth no cliente. USER_NOT_FOUND informa conta indisponível e remove resultado anterior que não pode mais ser confirmado. Contas sem qualquer vínculo não são descobertas por essa tela; não foi criado diretório de usuários ou busca manual por UUID.

## Arquivos

Criados:

- `frontend/src/features/perfil/PerfilPage.tsx`
- `frontend/src/features/vinculos/TransferenciaPage.tsx`, `vinculo.schema.ts`
- `frontend/src/features/administracao/AdminPage.tsx`, `VinculosAdminPage.tsx`, `administracao.regras.ts`
- `docs/FRONTEND_PERFIL_ADMINISTRACAO.md`

Alterados:

- `frontend/src/features/administracao/administracao.api.ts`, `administracao.types.ts`, `administracao.schema.ts`
- `frontend/src/features/vinculos/vinculo.api.ts`, `EstadoVinculoPage.tsx`
- `frontend/src/features/condominios/SeletorCondominio.tsx`
- `frontend/src/routes/AppRoutes.tsx`, `frontend/src/layouts/ShellPage.tsx`, `frontend/src/styles.css`
- `frontend/tests/infra.test.ts`, `frontend/tests/fluxos.browser.mjs`
- `AGENTS.md`, somente estado/rotas do frontend

Auth/providers e client central foram reutilizados sem alteração. BACKEND_INVENTARIO.md, FRONTEND_HANDOFF.md, manifests/lock e todos os fontes de backend/banco foram preservados.

## Verificação

`npm run build` passou na raiz, incluindo TypeScript do backend e TypeScript/Vite do frontend. `npm test --workspace frontend` passou com **63 testes Node**, seis novos sobre autoridade, autoalteração, transferência, filtros, corpos estritos e PATCH sem corpo. Não há lint frontend configurado.

A suíte completa `frontend/tests/fluxos.browser.mjs` passou com **149 cenários Chromium**, zero falhas ou skips: 106 cenários anteriores e 43 desta etapa. Reproduzir conforme [FRONTEND_INFRA.md](FRONTEND_INFRA.md#verificação-reproduzível), usando Vite com as variáveis públicas fictícias, Playwright/Chromium do ambiente temporário e APIs interceptadas no navegador.

Os cenários desta etapa verificam identidade/e-mail próprio, todos os estados residenciais, guards e transferência pendente, catálogo paginado e atual desabilitado, POST mínimo/201/duplo clique, conflitos/validação/estado reconsultado, acesso local versus super, tenant estrangeiro na URL, DTOs distintos, busca/status/página/refresh, PATCHs sem corpo, conflitos de aprovação, suspensão local inclusive do próprio único admin, boolean de privilégio, proibição de autoalteração local, ações globais com UUID de usuário/resultado compartilhado, USER_NOT_FOUND, confirmação cancelada, 403/perda de autoridade, corrida 409, resposta antiga de busca, suspensão global em uso e logout durante decisão. Há também verificação explícita de refresh nas cinco novas rotas.

Capturas de Perfil/Administração em 390 px e Administração em 1280 px foram inspecionadas; os testes verificam ausência de transbordamento horizontal. Confirmações usam os diálogos nativos existentes no projeto; labels, badges textuais, avisos, foco e estados de loading/empty/error mantêm os padrões anteriores.

Comparação SHA-256 confirmou **127 arquivos protegidos intactos** de backend/banco, inventário/handoff e manifests/lock; nenhum novo fonte em backend/database. Busca estática no frontend não encontrou supabase.from(), acesso a Storage, dangerouslySetInnerHTML ou variáveis VITE de segredo/banco; o bundle não contém literais de secret key/URL PostgreSQL.

Os testes de navegador utilizam SDK Auth real com **Auth/API simulados**, sem ações administrativas, transferência ou consultas em Supabase remoto. Não se afirma uma auditoria integrada contra dados reais nesta etapa. Não foi adicionado Playwright como dependência do projeto. Permanecem avisos não bloqueantes de anotações internas do Zod e bundle JavaScript de aproximadamente 663 kB (190 kB gzip).

Edição de Perfil, nova solicitação sem ATIVO após rejeição/encerramento, reativação local, diretório de todas as contas, notificações, pagamentos e auditoria integrada permanecem fora do escopo. A última alteração global exibida é um resultado do PATCH recebido nesta tela; sem endpoint de leitura de status global, não é apresentada como monitoramento de mudanças posteriores por outro administrador.
