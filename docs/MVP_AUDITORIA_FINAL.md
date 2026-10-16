# Auditoria integrada do MVP — Prompt 28

Data: 16/10/2026. Escopo: código e execução local do frontend, Express, JWT/JWKS, Prisma/PostgreSQL e integração com Storage simulado. Fontes: AGENTS.md, BACKEND_INVENTARIO.md, FRONTEND_HANDOFF.md e implementação/testes reais. Não houve deploy, mudança estrutural, endpoint novo ou funcionalidade nova.

**MVP_READY_FOR_USER_TESTING = YES**, para **testes internos controlados**. Build e evidências locais atendem aos critérios, sem P0/P1 aberto. Homologação remota do Supabase e testes com pessoas não foram executados; usar o [roteiro manual](MVP_TESTES_MANUAIS.md). Este resultado não afirma prontidão de produção.

## Ambiente e proteção dos dados

- `git status --short` retornou “not a git repository”. Commit/branch indisponíveis; não foram inventados. Snapshot SHA-256 inicial em `/tmp/prompt28-baseline.json` permite comparar os arquivos desta execução.
- Node/npm workspaces existentes; React 19, TypeScript, Vite, Express 5, Prisma 7, PostgreSQL 16, SDK Supabase e jose instalados. UI existente em React/CSS e componentes Campo/Aviso, sem biblioteca nova.
- PostgreSQL exclusivo em `/tmp/porta-mvp28-pg`, localhost:55448, banco **porta_onboarding_teste**. Instância nova, com o DDL existente. Nenhuma conexão de teste usou DATABASE_URL remoto.
- Os 14 scripts de integração recusam host fora de localhost/127.0.0.1 e banco com outro nome. A massa foi limpa somente nesse banco descartável entre suítes; nunca houve reset de projeto Supabase. O teste integrado adicional cria identidades/condomínios com UUIDs e nomes fictícios únicos por execução.
- Vite de testes :5174; build final com variáveis públicas fictícias e preview estático :5176. O smoke de `npm run dev` usou :5173/:3000, banco local e configurações fictícias. Arquivos `.env` não foram editados nem publicados.
- Playwright/Chromium já disponíveis em `/tmp/porta-frontend-browser`; nenhuma dependência adicionada ao projeto. Auth/JWKS e Storage remotos foram simulados, conforme os níveis de teste abaixo.
- Comparação de hashes preservou **125 arquivos protegidos** de backend/banco, inventário/handoff e manifests/lock. Prisma, DDL, migrations e permissões de produção não foram alterados.

## Baseline, correções e resultados

| Verificação | Baseline/diagnóstico | Resultado final |
| --- | --- | --- |
| Rotas Express descobertas por AST/imports/montagens | 27 | 27, mesmas rotas e contratos |
| Scripts backend `test:*` realmente presentes | 29: 15 unitários e 14 de integração | Todos executados; 475 testes passaram: 162 unitários + 313 integração |
| Build da raiz | Passou | Passou novamente após as correções |
| Frontend Node/TypeScript | 63 passaram | 63 passaram |
| Browser existente | Primeira execução em Vite: 147/149; interferência de HMR/contexto e verificação transitória de radio | **159/159** no build estático final; zero falhas/skips, 149 anteriores + 10 novos |
| Regressões novas antes da correção | Dois casos de pedido/sessão falharam; caso de overflow também falhou | Os casos direcionados passaram após as correções; incluídos na suíte completa |
| Jornada navegador → Express → PostgreSQL | Não existia como suíte única | Novo teste integrado atravessa A–F, I, J e K; Auth/JWKS/Storage simulados |
| `npm run dev` | Verificado nesta execução | API e Vite iniciaram; Chromium abriu Login, leu health e recebeu 401 sem Bearer; preflight CORS 204 |

As falhas intermediárias de infraestrutura foram investigadas: a execução inicial de browser coincidiu com alteração do provider em hot reload; uma tentativa de preview inicial usou um build com configuração pública diferente da fixture e não restaurou a sessão fictícia. O build final usa explicitamente as variáveis fictícias. O teste de seleção de condomínio agora verifica a navegação/filtro após click, sem depender do instante transitório de checked durante navegação. No novo mock de erros de Auth, foi incluído o header `x-supabase-api-version` e sua exposição CORS, exigidos pelo SDK instalado para interpretar `code`. Na suíte integrada, nomes únicos evitam selecionar massa de uma execução anterior. Esses ajustes de teste não foram tratados como defeitos de produção.

Resultado final: **698 testes aprovados** = 475 backend + 63 frontend Node + 159 browser mockados + 1 jornada integrada. A jornada integrada passou novamente contra o build final, sem skips; possui várias etapas/asserts, mas é contada como **um teste**, sem inflar o total. O smoke de dev/CORS é uma verificação adicional, não foi somado como teste Node. As execuções direcionadas e intermediárias não são somadas ao número de casos únicos finais.

### Achados e reprodução

| ID | Prioridade | Reprodução → observado → esperado | Causa/arquivos | Correção e evidência |
| --- | --- | --- | --- | --- |
| MVP-01 | **P1 resolvido** | Iniciar POST de pedido, sair, entrar com outra pessoa e receber MEMBERSHIP_REQUIRED atrasado. A nova pessoa ficava em carregamento; deveria conservar seu estado e dados. | Callback antigo de recarregarEstado cancelava a consulta atual e gravava um registro da identidade anterior. FormularioPedido também continuava a reagir após desmontagem. `EstadoUsuarioProvider.tsx`, `FormularioPedido.tsx`. | Provider recusa chamada de identidade obsoleta antes de abortar/limpar qualquer estado. Formulário ignora sucesso/erro depois de desmontar. Teste falhou antes e passou depois; regressão adicional de onboarding atrasado exercita a proteção central, e logout real em outra aba foi verificado. |
| MVP-02 | **P2 resolvido** | Servidor cria/reserva pedido, mas a resposta se perde na rede. A tela sugeria verificar conexão e tentar novamente, sem orientar consulta ao histórico. Esperado: comunicar resultado desconhecido e evitar reenvio cego. | Feedback genérico no catch de criação; não há idempotency key. `FormularioPedido.tsx`. | Aviso informa que o pedido pode ter sido criado e orienta conferir Meus Pedidos antes de tentar novamente, com link real. Preserva formulário, não afirma sucesso e não repete POST. Teste simula resposta perdida após gravação e encontra o pedido pelo histórico. |
| MVP-03 | **P2 resolvido** | Abrir detalhe em 360×800 com nome válido de 140 caracteres sem espaços. Havia overflow horizontal; esperado: título contido e legível. | Faltava quebra de palavra no h1 do detalhe. `styles.css`. | `overflow-wrap: anywhere` restrito ao título. Teste falhou antes e passou depois; varredura responsiva ampliada. |
| MVP-04 | **P3 pendente/opcional** | Build emite aviso de chunk JavaScript acima de 500 kB. | Bundle final ~663 kB, ~190 kB gzip; anotações internas do Zod também geram aviso não bloqueante. | Nenhuma refatoração de carregamento/dependência por preferência nesta auditoria. Considerar divisão por rotas conforme medição futura. |

Nenhum P0 demonstrado; nenhum P0/P1 permanece aberto. O aviso de depreciação do driver pg sobre query concorrente apareceu na execução integrada, sem falha; não houve atualização de dependência nesta etapa. Leitor de tela, teclado virtual real, entrega de e-mail, políticas/configuração remota e dispositivos físicos são verificações pendentes de homologação, não defeitos comprovados.

## Inventário real de telas

Foram encontrados **20 registros de Route**: 18 páginas, `/` e `*`. Guard de catálogo exige USUARIO_ATIVO; GuardHistorico exige perfil pertinente e sessão válida, sem ATIVO; GuardAdmin exige super ou admin no vínculo realmente ATIVO. Bloqueio global/erro de sessão precede conteúdo protegido. Leituras comuns após sessão: GET `/usuarios/me` e `/vinculos/me` no provider.

“L/E/R/V” = loading, erro com orientação/retry e vazio quando há coleção. “Sim” em refresh indica rota independente de estado de navegação; as cinco rotas do Prompt 27 têm teste explícito de reload, além dos testes de detalhe, histórico e chat. Classificação considera contrato, código e cenários executados; não significa homologação remota.

| URL | Página/componente | Guard e perfil | APIs específicas | Estados/refresh | Situação |
| --- | --- | --- | --- | --- | --- |
| `/` | Inicio | Resolvedor central de sessão/residência | Leituras comuns | Loading/bloqueio/redirect; sim | OK |
| `/login` | LoginPage | SEM_SESSAO | Supabase signInWithPassword | Loading, campos/erro, sessão; sim | OK |
| `/cadastro` | LoginPage cadastro | SEM_SESSAO | Supabase signUp | Loading, validação, sessão/confirmação; sim | OK |
| `/confirmar-email` | ConfirmarEmailPage | SEM_SESSAO | Orientação de Auth; callback na raiz | Orientação/retorno; sim | OK, entrega remota não executada |
| `/onboarding` | OnboardingPage | PRECISA_ONBOARDING | GET condominios; POST onboarding | L/E/R/V do catálogo, validação/201; sim | OK |
| `/aguardando-aprovacao` | EstadoVinculoPage pendente | AGUARDANDO_APROVACAO | GET vinculos/me e usuarios/me | PENDENTE/atualizar/bloqueio; sim | OK |
| `/estado-vinculo` | EstadoVinculoPage | VINCULO_INDISPONIVEL | Mesmas leituras | Último estado/atualizar/histórico; sim | OK |
| `/vitrine` | VitrinePage | Condômino/admin ATIVO | GET categorias/produtos | L/E/R/V, filtros/página URL; sim | OK |
| `/produtos/:id` | ProdutoPage | Condômino/admin ATIVO | GET produto por ID; POST pedido | L/E/R, 404, imagens/estimativa/sucesso; sim | OK |
| `/meus-produtos` | MeusProdutosPage | Condômino/admin ATIVO | GET produtos/me, categorias; PATCH status | L/E/R/V, filtros/ownership; sim | OK |
| `/meus-produtos/novo` | FormularioProdutoPage novo | Condômino/admin ATIVO | GET categorias; POST produtos | Loading/validação/erro/sucesso; sim | OK |
| `/meus-produtos/:id/editar` | FormularioProdutoPage | ATIVO e vínculo dono, revalidado no servidor | GET produto; PATCH produto/status; POST/DELETE imagens | L/E/R, ownership, rascunho/imagens; sim | OK |
| `/pedidos` | MeusPedidosPage | GuardHistorico, perfil condômino | GET pedidos/me; PATCH status | L/E/R/V, papel/status/histórico; sim | OK |
| `/pedidos/:id/chat` | ChatPedidoPage | Partes históricas; super observador | GET chat; POST chat/messages | L/E/R/V, ENCERRADA/leitura/envio; sim | OK |
| `/perfil` | PerfilPage | Perfil próprio, inclusive histórico; super simplificado | Leituras comuns; email da sessão | Loading/erro/estados residenciais; sim | OK |
| `/perfil/transferencia` | TransferenciaPage | Condômino ATIVO sem solicitação pendente | GET condominios; POST vinculos/transferencia | L/E/R/V catálogo, validação/201/conflito; sim | OK |
| `/admin` | AdminPage | GuardAdmin: local ATIVO ou super | Leituras comuns; links reais | Loading/erro/negação; sim | OK |
| `/admin/vinculos` | VinculosAdminPage | Local no próprio tenant; super global | GET admin/vinculos; quatro PATCH de vínculo e PATCH de conta para super | L/E/R/V, filtros/confirmar/refetch; sim | OK |
| `/admin/vinculos/pendentes` | VinculosAdminPage pendentes | Mesmo guard/escopo | GET fila; PATCH aprovar/rejeitar sem body | L/E/R/V, 409/confirmar/refetch; sim | OK |
| `*` | Inicio | Resolução central | Leituras comuns se houver sessão | Destino conforme estado; sem rota paralela insegura | OK por código/guarda |

Publicação/compra pelo super, vitrine global com seletor na UI, edição de Perfil, nova solicitação sem ATIVO, diretório de contas sem vínculo, pagamentos, reputação, realtime, leitura de chat, notificações e serviços: **FORA DO ESCOPO**. A API permite consulta de vitrine por super com condomínio explícito; o frontend atual não oferece essa jornada, nem concede residência artificial.

## Inventário HTTP e compatibilidade

Descoberta pelo percurso AST de app.use/router/imports, incluindo montagem de chat e usuarioRoutes sem prefixo. Mantêm-se as **27 operações** do inventário anterior:

| Grupo | Operações reais |
| --- | --- |
| Saúde | GET /api/health |
| Identidade | POST /api/onboarding; GET /api/usuarios/me |
| Condomínios | GET /api/condominios |
| Vínculos | GET /api/vinculos/me; POST /api/vinculos/transferencia |
| Administração | GET /api/admin/vinculos; GET /api/admin/vinculos/pendentes; PATCH /api/admin/vinculos/:id/aprovar, /rejeitar, /suspender, /admin; PATCH /api/admin/usuarios/:id/status |
| Categorias | GET /api/categorias |
| Produtos | GET /api/produtos, /api/produtos/me, /api/produtos/:id; POST /api/produtos; PATCH /api/produtos/:id, /api/produtos/:id/status; POST /api/produtos/:id/imagens; DELETE /api/produtos/:id/imagens/:idImagem |
| Pedidos | POST /api/pedidos; GET /api/pedidos/me; PATCH /api/pedidos/:id/status |
| Chat | GET /api/pedidos/:id/chat; POST /api/pedidos/:id/chat/messages |

Os clients examinados chamam métodos/paths/corpos reais. A jornada integrada usa os clients de produção contra Express, sem inventar DTOs das respostas de domínio. Lista paginada conserva dados[] e paginacao na raiz; chat acrescenta conversa/pedido. DELETE de imagem retorna 204; aprovar/rejeitar/suspender não enviam body nem `{}`. Fila usa morador.id_condomino e lista geral usa morador.id_usuario. Conta global inicial não é inventada; PATCH global usa identidade de usuário e resultado compartilhado entre seus vínculos.

Dinheiro permanece string decimal; POST de pedido envia apenas produto/quantidade/horário, com valor definitivo do servidor. Edição de produto envia apenas diferenças; categoria inativa pode ser mantida omitindo id_categoria. FormData tem somente imagem, sem Content-Type manual. Signed URLs permanecem temporárias e não são referência persistida. GET /pedidos/:id não foi criado ou presumido. Códigos reais MEMBERSHIP_REQUIRED, INVALID_ORDER_TRANSITION, CONDOMINIO_NOT_FOUND e CONDOMINIUM_NOT_FOUND foram preservados.

**Nenhuma divergência de contrato comprovada.** BACKEND_INVENTARIO.md e FRONTEND_HANDOFF.md permaneceram intactos: sua descrição do frontend pré-Prompt 23 é uma fotografia histórica, não um contrato HTTP modificado. O estado atual fica neste relatório e em AGENTS.md.

## Jornadas A–N: evidências por camada

Todas as linhas abaixo possuem automação; **nenhuma indica teste manual remoto**. “Integrado” significa navegador + Express/Prisma/PostgreSQL reais, com Auth/JWKS e Storage simulados. “Browser mockado” usa SDK Auth real e HTTP de domínio interceptado. “PG” usa PostgreSQL local e JWT/JWKS/Storage simulados conforme cada suíte.

| Jornada | Cobertura real | Ferramenta/evidência |
| --- | --- | --- |
| A. Login → onboarding → pendente → aprovação → ativo → vitrine | PASSOU AUTOMATIZADO | mvp.integrado.browser.mjs; fluxo A em aprovar-vinculo.integration; signup imediato/confirmação/callback também no browser mockado |
| B. Busca/categoria → detalhe → pedido → histórico | PASSOU AUTOMATIZADO | Integrado para compra/histórico; filtros/categoria/URL/refresh no browser mockado; pedido.integration |
| C. Publicar → imagens → outro morador visualiza/compra | PASSOU AUTOMATIZADO | Integrado com multipart real no Express, metadata/SQL reais e Storage simulado; criar-produto/imagem-produto.integration |
| D. Aceitar → chat → concluir → histórico | PASSOU AUTOMATIZADO | Integrado por duas sessões; pedido.integration verifica histórico, papel e mensagem |
| E. Cancelar/recusar → restituição única | PASSOU AUTOMATIZADO | UI integrada + consulta SQL + repetição HTTP 409; pedido.integration cobre rollback/restituição |
| F. Transferir → antigo ativo + pendente → aprovação → histórico | PASSOU AUTOMATIZADO | Integrado consulta novo tenant, anúncio antigo inativo/FK original e pedidos históricos; aprovar-vinculo.integration |
| G. Pedido aberto bloqueia transferência sem alteração parcial | PASSOU AUTOMATIZADO | PG em aprovar-vinculo.integration, inclusive comprador/vendedor; browser mockado mantém PENDENTE e explica erro |
| H. Último admin bloqueia local; super pode intervir | PASSOU AUTOMATIZADO | PG em aprovar-vinculo.integration; UI de conflito no browser mockado |
| I. Admin X não modifica Y; ownership e chat alheio negados | PASSOU AUTOMATIZADO | HTTP real integrado e suítes PG; claims administrativas forjadas não autorizam |
| J. Suspensão global → bloqueio → reativação sem alterar vínculo | PASSOU AUTOMATIZADO | UI integrada + SQL; mesmo contexto/token após suspensão; aprovar-vinculo.integration e admin-vinculo.integration |
| K. Sem ATIVO conserva pedidos/chat próprios | PASSOU AUTOMATIZADO | Integrado após suspensão local; browser mockado também cobre SUSPENSO/ENCERRADO/REJEITADO e ausência de residência |
| L. URL/refresh/back/logout/troca de pessoa/abas | PASSOU AUTOMATIZADO | Browser completo, logout real em outra aba, POST antigo e onboarding antigo; guards e cancelamento de consultas |
| M. Duas compras disputam última unidade | PASSOU AUTOMATIZADO | pedido.integration: UPDATE condicional e PostgreSQL real, apenas uma reserva, sem estoque negativo |
| N. Duas transições, uma vencedora e uma restituição | PASSOU AUTOMATIZADO | pedido.integration: corridas de status e histórico, sem dupla devolução |

Signup/entrega de e-mail e token emitido pelo Supabase remoto: **NÃO EXECUTADO remotamente**, coberto por simulação de Auth/SDK e validação JWT local. Storage remoto privado, signed URLs reais/expiração e permissões da conta Prisma no projeto: **NÃO EXECUTADO remotamente**. A checklist manual inclui essas verificações antes de demonstração remota.

## Segurança, transações e estado

- Middleware verifica assinatura ES256/RS256, JWKS, issuer, audience, exp e sub; roles vêm do banco. JWT/metadata/tenant fornecidos pelo cliente não conferem autoridade. Conta SUSPENSA é negada mesmo com token válido.
- Isolamento real foi exercitado na API: morador X versus Y, morador versus anúncio de outro, admin X versus Y, terceiro versus pedido/chat, super sem bypass de transição/envio. UI é apenas a camada de experiência.
- Reserva, total Decimal, histórico inicial, conversa e participantes permanecem atômicos; cancelamento/recusa usam status condicional e restituição na mesma transação. Locks de vínculo, mutex por condomínio e transações não foram alterados.
- Aprovação preserva pedidos/chat/FKs originais, desativa produtos antigos e ativa destino/admin=false; pedidos abertos e regra do último administrador continuam no servidor. Solicitar transferência não executa esses efeitos no browser.
- Travas de UI, AbortController e callbacks atuais impedem duplicação/resultado antigo. Novo guard de identidade no provider impede que callback antigo aborte a consulta da conta nova. Retry central permanece restrito a um 401, novo token da mesma identidade; não há retry genérico de POST/PATCH/DELETE por rede/409.
- Frontend/src não contém chamadas supabase.from(), Storage direto, dangerouslySetInnerHTML, segredo ou URI PostgreSQL. Comparação sem imprimir valores não encontrou secret key/DATABASE_URL privados do backend no bundle. O literal dangerouslySetInnerHTML existe internamente no runtime React do bundle, não como uso da aplicação; testes de chat renderizam conteúdo como texto.
- Somente chaves públicas VITE foram usadas no browser. Não há persistência própria adicional de token; SDK cuida da sessão. Logs/relatórios não incluem JWT, credenciais privadas ou CPF real. Exemplos de env mantêm separação pública/privada.
- CORS do Express aceita a origem configurada. Smoke real verificou preflight 204, resposta health e 401 sem Bearer pelo navegador. Não foi adicionada política nova de CSRF ou infraestrutura.
- Não há idempotency key no POST de pedido: resultado desconhecido exige conferir histórico. A nova orientação reduz reenvio acidental, sem inventar garantia de idempotência.

## Responsividade e acessibilidade

Automação percorreu **12 telas protegidas × 4 viewports**, 360×800, 390×844, 768×1024 e 1280×800. Verificou ausência de overflow, um main e h1, labels de inputs/select/textarea, alt de imagens e IDs únicos. Também exercitou foco/Enter da navegação e sequência Tab de Login em cada viewport. Teste específico cobre nome sem espaços com 140 caracteres. Outras suítes cobrem erro de imagem/placeholder, alertas, estado textual e confirmação nativa.

Foram vistas capturas reais de Produto 360, Administração 390, Vitrine 768 e Perfil 1280, além do título longo após correção. A paleta e os componentes existentes foram preservados. Capturas em `/tmp/porta-mvp28-<largura>-<tela>.png` são evidência local temporária, não dados de pessoas reais.

Isso não equivale a auditoria WCAG completa: não houve leitor de tela, teclado virtual físico, Safari/iOS/Android reais, zoom/alto contraste de sistema ou medição de performance em rede móvel. Esses itens permanecem no roteiro manual. Não foi instalado axe ou outro pacote só para esta auditoria.

## Comandos e reprodução

Comandos efetivamente utilizados:

```bash
npm run build
npm test --workspace frontend
# Todos os 29 nomes test:* descobertos em backend/package.json:
npm run <script-existente> --workspace backend
npm run dev
```

Para o build de browser isolado, o primeiro comando recebeu `VITE_SUPABASE_URL=http://auth.porta.test`, `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_EXEMPLO_TESTE` e `VITE_API_URL=http://api.porta.test/api`. Nenhum arquivo .env foi sobrescrito.

Preparação equivalente do banco de teste **novo e exclusivo**, depois de escolher uma porta livre:

```bash
/usr/lib/postgresql/16/bin/initdb -D /tmp/porta-mvp28-pg -A trust --no-locale -E UTF8
/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/porta-mvp28-pg \
  -l /tmp/porta-mvp28-pg.log -o '-h 127.0.0.1 -p 55448 -k /tmp' -w start
/usr/lib/postgresql/16/bin/createdb -h 127.0.0.1 -p 55448 -U renan porta_onboarding_teste
/usr/lib/postgresql/16/bin/psql -h 127.0.0.1 -p 55448 -U renan \
  -d porta_onboarding_teste -v ON_ERROR_STOP=1 -f database/00_ddl_base.sql
export ONBOARDING_TEST_DATABASE_URL=postgresql://renan@127.0.0.1:55448/porta_onboarding_teste
```

Ajustar o usuário local conforme o ambiente. Nunca reaplicar initdb/DDL ou limpeza em diretório/banco já usado por outra pessoa. O runner desta execução em `/tmp/porta-mvp28-regressao.py` percorreu os scripts existentes sequencialmente e limpou somente a massa do banco descartável antes de cada integração; é um artefato temporário, não um script de produção.

Com preview do build fictício em localhost:5176 e Playwright já instalado no ambiente:

```bash
FRONTEND_TEST_URL=http://127.0.0.1:5176 \
PLAYWRIGHT_BROWSERS_PATH=/tmp/porta-frontend-browser/browsers \
PLAYWRIGHT_MODULE=/tmp/porta-frontend-browser/node_modules/playwright/index.mjs \
node frontend/tests/fluxos.browser.mjs

# Requer também o build do backend, o banco local preparado e sua variável acima:
FRONTEND_TEST_URL=http://127.0.0.1:5176 \
PLAYWRIGHT_BROWSERS_PATH=/tmp/porta-frontend-browser/browsers \
PLAYWRIGHT_MODULE=/tmp/porta-frontend-browser/node_modules/playwright/index.mjs \
node frontend/tests/mvp.integrado.browser.mjs
```

A suíte integrada recusa host/banco inadequados antes de importar a API. Usa o backend compilado, intercepta somente o transporte do navegador para a API local e simula Auth/JWKS/Storage. As respostas de negócio vêm do Express/Prisma reais. Cada execução cria massa única e não apaga histórico; não rodar ao mesmo tempo que um reset de outra suíte. Não há script de lint frontend configurado; nenhum lint inexistente foi alegado.

Logs desta execução ficam em `/tmp/porta-mvp28-*`: build-baseline/build-final, front-baseline/front-final, backend-resumo/resultados, test-<módulo>, repro/repro-corrigido, responsivo-repro/responsivo-corrigido, visual, browser-final, integrado-final e dev-smoke. São evidências locais temporárias; os resultados consolidados deste documento permitem revisar o alcance sem depender de dados privados.

## Arquivos e preservação

Produção: `frontend/src/features/perfil/EstadoUsuarioProvider.tsx`, `frontend/src/features/pedidos/FormularioPedido.tsx`, `frontend/src/styles.css`.

Testes: ampliado `frontend/tests/fluxos.browser.mjs`; criado `frontend/tests/mvp.integrado.browser.mjs`. Documentação: este relatório, `docs/MVP_TESTES_MANUAIS.md` e estado/regras aprendidas em AGENTS.md.

Backend, schema Prisma, SQL, manifests, lock, contratos auditados e arquivos de configuração privados permaneceram intactos. Nenhuma biblioteca, tela, endpoint ou mecanismo de deploy foi adicionado.

## Checklist e decisão

- [x] Build de ambos os workspaces e tipos passaram.
- [x] 27 contratos reais e 20 registros React inventariados.
- [x] 475 testes backend e 63 frontend Node passaram.
- [x] Jornadas essenciais A–F atravessaram navegador/Express/PostgreSQL local.
- [x] Autorização/tenant e concorrência possuem evidência de HTTP/PG reais.
- [x] P1 de troca de identidade corrigido e reproduções viraram regressões.
- [x] Incerteza do POST e overflow móvel corrigidos sem mudar contratos.
- [x] Limites remotos, acessibilidade e avisos opcionais declarados.
- [x] Browser final: 159/159; jornada integrada: 1/1, ambos sem falhas/skips.
- [x] Encerrados os processos iniciados pela auditoria: dev da raiz após smoke (SIGINT intencional), Vite/preview de teste e PostgreSQL local descartável. Arquivos locais de evidência preservados.

**MVP_READY_FOR_USER_TESTING = YES.** As jornadas A–F essenciais têm evidência local integrada, a API impõe autorização/tenant, build/testes passam e não há P0/P1 demonstrado em aberto. O alcance é **testes internos controlados do MVP**, sem homologação remota, garantia de produção ou deploy. A próxima etapa é executar o roteiro manual com contas de teste e validar a configuração de demonstração, somente quando solicitado.

## Adendo Prompt 29 — 16/10/2026

Nova entrega autorizada: superadmin cadastra condomínios; admin local não cadastra. Evidências do Prompt 28 acima permanecem históricas. Estado atual: **28 operações Express** (recontagem AST de imports/montagens), **21 registros React**; nova POST /api/admin/condominios e página /admin/condominios, sem GET administrativo adicional.

- [x] JWT/conta global/super resolvidos pelo backend, exigirSuperAdmin() e checagem no service; morador/admins de dois tenants recebem 403 mesmo forjando privilégios.
- [x] Body de três campos estrito, limites reais, DTO/ISO/defaults do PostgreSQL, CEP/nome repetidos permitidos; sem DDL/Prisma/dependência nova.
- [x] Condomínio e CREATE_CONDOMINIUM atômicos; ator real/metadata mínima; falha de auditoria provoca rollback PostgreSQL.
- [x] Menu/guard somente super, formulário Zod, cancelamento, trava de submit, catálogo ativo paginado/busca/refresh, sucesso real e resultado de rede incerto sem repetição automática.
- [x] Novo destino disponível por GET/busca e onboarding PENDENTE; primeiro aprovado pelo super sem admin prévio; promoção explícita não concede criação ao local.
- [x] Build/TypeScript de ambos passaram. Todos os 31 scripts backend aprovados: 487 testes (167 unitários/320 PostgreSQL). Frontend Node 64; Chromium 172/172; jornada integrada 1/1; zero falhas/skips finais. Total 724, sem somar reexecuções.
- [x] Fixtures antigas de status/imagem tinham horário combinado fixo já passado; alteradas para 2099, sem mudar regras de produção. Expectativas de texto/URL dos novos testes corrigidas; um timeout de refresh anterior passou isolado e na suíte completa final.
- [x] AGENTS, inventário, handoff e roteiro manual atualizados; artefatos gerados e dependências privadas não incorporados. Preview/PG descartável encerrados após os testes.

Relatório com arquivos, scripts/resultados, curl e comandos: [CONDOMINIOS_SUPERADMIN.md](CONDOMINIOS_SUPERADMIN.md). Mocks de domínio são usados na suíte Chromium; jornada integrada usa Express/Prisma/PostgreSQL reais, com Auth/JWKS/Storage simulados. Quatro larguras e captura mobile da nova página foram verificadas. Avisos não bloqueantes de bundle/Zod/pg permanecem; não houve refatoração global.

**MVP_READY_FOR_USER_TESTING = YES**, para próxima rodada de homologação interna controlada. Não houve homologação contra Supabase remoto nem deploy. Validar configuração real do Supabase, e-mails, permissões e Storage no ambiente de demonstração; dispositivos físicos/leitor de tela continuam no roteiro manual.
