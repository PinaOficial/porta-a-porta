# Frontend — infraestrutura, Auth e onboarding

Prompt 23, 16/10/2026. Implementação React/TypeScript com React Router, contextos pequenos e CSS mobile-first terracota/creme. Os contratos do [handoff auditado](FRONTEND_HANDOFF.md) continuam sendo a referência de dados; as observações daquele documento sobre frontend ainda ausente descrevem o momento do Prompt 22.

## Executar

Instale os workspaces na raiz com `npm install`. Configure `frontend/.env` a partir de `frontend/.env.example`, somente com `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e `VITE_API_URL`. O exemplo existente já contém placeholders seguros e foi preservado. A API tem fallback `http://localhost:3000/api`. `npm run dev` inicia backend e frontend; a API precisa da configuração própria já documentada no backend.

Supabase Auth deve permitir a origem do frontend e a URL de retorno `<origem>/` na configuração de redirecionamentos. O cadastro informa esse retorno. O cliente detecta a sessão do callback, persiste e renova a sessão automaticamente. A configuração real de confirmação de e-mail é respeitada: sessão imediata segue o fluxo autenticado; usuário sem sessão abre confirmação. Configure também a origem permitida pelo CORS do backend. Em hospedagem SPA, encaminhe caminhos de frontend para `index.html` para permitir recarregar rotas internas.

Dependência adicionada ao projeto: **react-router-dom ^7.18.4**. Não foi adicionado framework de estado, CSS ou testes. Os componentes shadcn ainda não existiam no template; esta etapa utiliza componentes React/CSS pequenos.

## Sessão, domínio e navegação

`AuthProvider` restaura `getSession()` antes de liberar os guards, registra `onAuthStateChange` com cleanup e expõe sessão, usuário Auth, loading, login, cadastro, logout e refresh. O callback de eventos é síncrono para não aguardar métodos Auth dentro do lock do SDK.

`EstadoUsuarioProvider` é separado: lê `/usuarios/me` e `/vinculos/me` em paralelo, valida a identidade da resposta e publica usuário, situação residencial, loading, erro e refetch. Mudanças de identidade ocultam dados anteriores já no render; cleanup e AbortController descartam respostas antigas. Logout limpa a sessão e o estado de domínio. Nenhum CPF/formulário é persistido pelo aplicativo.

`resolverEstadoAplicacao()` é uma função pura. Durante restauração há splash neutra; respostas ausentes ou incoerentes mostram erro com retry, sem loops de redirecionamento. Os guards reaplicam a decisão em cada rota e não substituem a autorização do backend.

| Estado | Rota/destino |
| --- | --- |
| Sem sessão | `/login`, `/cadastro`, `/confirmar-email` são públicas |
| Sem onboarding | `/onboarding` |
| PENDENTE, sem ATIVO | `/aguardando-aprovacao` |
| ATIVO, inclusive com transferência PENDENTE | `/vitrine` |
| Sem ATIVO/PENDENTE, último REJEITADO/SUSPENSO/ENCERRADO | `/estado-vinculo` |
| Super admin, sem exigir residência | `/admin` |
| Conta global suspensa | Bloqueio global na rota atual, somente orientação/logout |
| Falha de estado/sessão | Erro recuperável na rota atual, retry/logout |

`/` e caminhos desconhecidos resolvem o destino do estado atual. Morador/admin local não entra no shell global de super. Pedidos, Perfil e Administração local são reservas de navegação explicitamente desabilitadas, sem páginas fictícias. As futuras páginas de pedidos/chat deverão permitir histórico sem ATIVO usando guards próprios; o guard da vitrine não deve ser reutilizado indiscriminadamente.

## HTTP e erros

`apiFetch<T>(path, { method, json, body, signal, headers })` obtém a sessão, envia Bearer e Accept, serializa somente `json` e preserva o envelope real `{ dados, paginacao? }`. `body: FormData` não recebe Content-Type manual. Resposta 204 retorna undefined, sem chamar JSON.

`ApiError` preserva status, código, mensagem e detalhes Zod; falhas de conexão recebem status 0/NETWORK_ERROR. Após 401 UNAUTHENTICATED há no máximo um refresh e uma repetição, exclusivamente com token novo da mesma identidade ainda autenticada. Uma renovação em voo pode ser compartilhada. Rede/409 não repetem escritas. Erros globais de sessão/conta são observados pelo provider e retiram conteúdo protegido, inclusive quando vierem de outra feature.

Login/cadastro traduzem falhas Auth para mensagens úteis. Formulários possuem labels, erros associados por aria-describedby e alertas; foco é visível. Erros de onboarding preservam os campos e tratam CPF/e-mail duplicados, condomínio indisponível, e-mail ausente, cadastro já realizado e conta super. VALIDATION_ERROR mostra erros por campo. Cadastro já concluído dispara refetch.

## Onboarding e estado residencial

Zod valida nome trim 1..160, CPF normalizado com 11 dígitos sem algoritmo verificador, data ISO existente, condomínio UUID e moradia trim 1..80. O seletor busca condomínios ativos com debounce de 300 ms e paginação de 20; omite busca vazia, mostra seleção, loading, vazio, erro/retry e páginas. Envio é desabilitado sem seleção e possui proteção contra duplo clique.

POST envia somente os cinco campos do contrato. Após 201, o frontend relê os dois endpoints: nenhum vínculo é fabricado. A tela pendente mostra condomínio/moradia/data e atualização manual de status. A aprovação detectada redireciona ao shell. ATIVO + PENDENTE mantém residência atual e mostra destino da transferência. Histórico indisponível mostra o estado sem ressubmissão. Super recebe shell separado e nenhuma consulta administrativa pesada.

## Arquivos da etapa

Novos:

- `frontend/src/lib/api.client.ts`: transporte e ApiError testáveis.
- `frontend/src/features/auth/AuthProvider.tsx`, `LoginPage.tsx`: sessão, login/cadastro e confirmação.
- `frontend/src/features/perfil/EstadoUsuarioProvider.tsx`: estado de domínio.
- `frontend/src/features/vinculos/vinculo.types.ts`, `vinculo.api.ts`, `EstadoVinculoPage.tsx`: DTO, leitura e telas residenciais.
- `frontend/src/features/condominios/SeletorCondominio.tsx`: seleção paginada.
- `frontend/src/features/onboarding/OnboardingPage.tsx`: formulário inicial.
- `frontend/src/routes/estadoAplicacao.ts`, `AppRoutes.tsx`: resolver, guards e rotas.
- `frontend/src/layouts/Pagina.tsx`, `ShellPage.tsx`, `frontend/src/components/ui/Campo.tsx`, `frontend/src/styles.css`: apresentação e acessibilidade.
- `frontend/tsconfig.test.json`, `frontend/tests/infra.test.ts`, `frontend/tests/fluxos.browser.mjs`: verificações.
- `docs/FRONTEND_INFRA.md`: este relatório.

Alterados:

- `frontend/package.json`, `package-lock.json`: roteador e comando de testes.
- `frontend/src/App.tsx`, `frontend/src/lib/api.ts`, `frontend/src/lib/supabase.ts`: composição, cliente HTTP e opções explícitas de persistência/renovação.
- `frontend/src/features/auth/auth.api.ts`, `auth.schema.ts`: Auth e formulários.
- `frontend/src/features/perfil/perfil.api.ts`, `perfil.types.ts`: leitura própria.
- `frontend/src/features/condominios/condominio.api.ts`, `condominio.types.ts`: contrato paginado.
- `frontend/src/features/onboarding/onboarding.api.ts`, `onboarding.schema.ts`, `onboarding.types.ts`: contrato/validação.
- `AGENTS.md`: somente estado atual e orientações do frontend.

Nenhuma alteração em backend/src, Prisma ou database; hashes comparados com o início da etapa. Nenhum recurso posterior de comércio foi implementado.

## Verificação reproduzível

Na raiz:

```bash
npm run build
npm test --workspace frontend
```

Build dos dois workspaces passou. TypeScript strict e **21 testes Node** passaram: resolver, validação, Bearer, envelopes, 204, FormData, JSON, ApiError/Zod, renovação limitada, identidade e ausência de retry em rede/conflito. O teste usa Node/tsx já instalado no workspace backend. Não há script lint frontend.

**18 cenários Chromium** passaram, com o SDK Supabase real no navegador e HTTP Auth/API simulados: login, ambos cadastros, callback de confirmação, onboarding/aprovação/refetch, refresh sem flash, busca/paginação/vazio, campos preservados, transferência, três estados históricos, super, suspensão global, logout/troca de conta, falha transitória, 401/refresh e resposta em voo após logout. Isso valida integração do frontend com os contratos simulados; não executa signup ou gravações no Supabase real. Capturas mobile (390 px) e desktop (1280 px) foram inspecionadas.

Playwright foi instalado somente em `/tmp`, sem dependência adicional no projeto. Para repetir em um ambiente de desenvolvimento com Playwright disponível, inicie uma instância Vite separada com valores **fictícios**:

```bash
VITE_SUPABASE_URL=http://auth.porta.test \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_EXEMPLO_TESTE \
VITE_API_URL=http://api.porta.test/api \
npm run dev --workspace frontend -- --host 127.0.0.1 --port 5174 --strictPort
```

Em outro terminal:

```bash
PLAYWRIGHT_MODULE=/caminho/para/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/caminho/para/browsers \
node frontend/tests/fluxos.browser.mjs
```

O módulo também pode ser resolvido como `playwright` se já disponível no ambiente. `FRONTEND_TEST_URL` permite substituir a origem local. Os mocks interceptam apenas as duas origens fictícias acima; não apontar esse teste para uma instância com credenciais reais.

O build emite avisos não bloqueantes de anotações internas do Zod e chunk JavaScript de aproximadamente 576 kB (169 kB gzip). Não há falha de compilação. Divisão adicional de bundles pode ser avaliada quando as próximas features forem implementadas.

A etapa termina aqui. Vitrine real, detalhe de produto, criação de pedido, Meus Produtos/Pedidos, imagens, chat, Perfil/transferência completos e administração completa aguardam os próximos prompts.
