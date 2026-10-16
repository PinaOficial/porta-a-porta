# AGENTS.md — Porta a Porta

Este arquivo é a instrução principal para agentes de código (Codex) que trabalharem neste repositório.

Contratos auditados no Prompt 22, MVP auditado no Prompt 28 e cadastro exclusivo de condomínios acrescentado no Prompt 29 (16/10/2026). Para contratos e rastreabilidade, leia [docs/BACKEND_INVENTARIO.md](docs/BACKEND_INVENTARIO.md) e [docs/FRONTEND_HANDOFF.md](docs/FRONTEND_HANDOFF.md). Planejamento antigo não prova que uma rota existe; confira código, schema e testes atuais.

Leia este documento **antes de alterar código**.

---

## 1. Objetivo do projeto

Porta a Porta é uma aplicação web responsiva/mobile-first para comércio hiperlocal entre moradores do mesmo condomínio.

No MVP atual:

- usuários autenticam por e-mail/senha via Supabase Auth;
- uma pessoa possui identidade global única;
- um condômino pode possuir vínculos residenciais históricos, mas no máximo um vínculo ATIVO e um PENDENTE;
- um usuário com vínculo ATIVO vê somente a vitrine do seu condomínio;
- moradores ativos podem publicar produtos;
- pedidos reservam estoque e congelam o valor no momento da solicitação;
- chat existe somente após um pedido;
- admin de condomínio administra apenas seu condomínio;
- super admin possui autoridade global;
- histórico não deve ser apagado fisicamente.

---

## 2. Stack obrigatória

### Frontend

- React
- TypeScript
- Vite
- shadcn/ui para componentes de UI conforme necessário
- Zod para formulários/validação de UX
- `@supabase/supabase-js` somente para autenticação/sessão do usuário

### Backend

- Node.js
- Express
- TypeScript em modo strict
- Zod
- Prisma ORM 7
- PostgreSQL do Supabase
- Supabase Storage
- `jose` para validação JWT/JWKS

### Banco/Auth/Storage

- Supabase PostgreSQL
- Supabase Auth
- Supabase Storage

---

## 3. Decisão arquitetural central: database-first

O banco PostgreSQL é a fonte de verdade do esquema.

Fluxo obrigatório para mudanças estruturais:

```text
SQL no Supabase
    ↓
prisma db pull
    ↓
prisma generate
    ↓
código TypeScript
```

Na raiz existe:

```bash
npm run prisma:sync
```

que executa `db pull` + `generate`.

### NÃO fazer

- não criar uma model Prisma manualmente antes de existir no banco;
- não usar `prisma db push` para criar/alterar o banco deste projeto;
- não usar `prisma migrate dev` nesta fase acadêmica;
- não renomear models/fields gerados para inglês;
- não criar aliases com `@map` ou `@@map` apenas por estética;
- não tratar `schema.prisma` como fonte primária do banco.

Se uma nova tabela surgir, primeiro crie o SQL no diretório `database/alteracoes/`, execute no Supabase e depois rode `npm run prisma:sync`.

---

## 4. Linguagem e nomenclatura

O domínio do projeto deve usar **português** para reduzir tradução mental entre documento, banco e código.

Exemplos:

```text
produto
pedido
condominio
vinculo
usuario
```

Arquivos:

```text
produto.controller.ts
produto.service.ts
produto.repository.ts
produto.schema.ts
produto.model.ts
produto.routes.ts
```

Funções também podem usar português claro:

```ts
listarProdutosDoCondominio()
criarProduto()
atualizarEstoque()
```

Termos técnicos consolidados podem permanecer em inglês:

```text
middleware
repository
service
controller
routes
schema
```

---

## 5. Estrutura geral

```text
porta-a-porta/
├── frontend/
├── backend/
├── database/
├── AGENTS.md
├── GUIA_PASSO_A_PASSO_SUPABASE_PRISMA.md
└── package.json
```

A raiz é um npm workspace.

Um único comando deve iniciar frontend e backend:

```bash
npm run dev
```

---

## 6. Estrutura do backend

```text
backend/src/
├── config/
│   └── env.ts
├── lib/
│   ├── prisma.ts
│   └── supabase.ts
├── middlewares/
│   ├── autenticar.ts
│   ├── autorizar.ts
│   ├── validar.ts
│   └── error-handler.ts
├── modules/
│   ├── usuarios/
│   ├── condominios/
│   ├── vinculos/
│   ├── categorias/
│   ├── produtos/
│   ├── pedidos/
│   ├── chat/
│   ├── administracao/
│   └── auditoria/
├── routes/
│   └── index.ts
├── types/
│   └── express.d.ts
├── app.ts
└── server.ts
```

Não crie subpastas `controllers/`, `services/`, `models/` etc. dentro de cada módulo enquanto houver apenas um arquivo de cada responsabilidade.

Exemplo correto:

```text
modules/produtos/
├── produto.model.ts
├── produto.schema.ts
├── produto.repository.ts
├── produto.service.ts
├── produto.controller.ts
└── produto.routes.ts
```

---

## 7. Responsabilidade de cada arquivo do backend

### `*.routes.ts`

Responsável somente por:

- declarar rotas Express;
- conectar middlewares;
- chamar controller.

Não pode conter regra de negócio nem query Prisma.

### `*.controller.ts`

Responsável por:

- ler `params`, `query`, `body` e contexto autenticado;
- chamar service;
- transformar resultado em resposta HTTP;
- escolher status HTTP.

Não deve concentrar regra de negócio nem query Prisma.

### `*.schema.ts`

Responsável pelos schemas Zod do módulo.

Exemplos:

- body de criação;
- atualização;
- params;
- querystring;
- filtros.

Toda entrada não confiável deve ser validada antes de alcançar o service.

### `*.service.ts`

É a camada principal de regra de negócio.

Responsável por:

- autorização específica do caso de uso;
- regras do domínio;
- transações;
- coordenação de repositories;
- códigos de erro estáveis.

Não recebe `Request` ou `Response` do Express.

### `*.repository.ts`

Responsável por queries Prisma.

Use repository para manter Prisma fora de controllers e para centralizar consultas do módulo.

Não coloque regra de negócio relevante aqui.

### `*.model.ts`

Responsável por tipos/DTOs específicos do módulo que não pertencem naturalmente ao Prisma ou ao Zod.

Não recrie manualmente todos os tipos do banco. Use os tipos gerados pelo Prisma quando fizer sentido.

---

## 8. Zod: onde ficam as validações

### Backend

Validação confiável fica próxima do módulo:

```text
modules/produtos/produto.schema.ts
modules/pedidos/pedido.schema.ts
modules/vinculos/vinculo.schema.ts
```

Payload HTTP deve ser validado no backend mesmo que o frontend já tenha validado.

### Frontend

Schemas do frontend ficam dentro da feature:

```text
frontend/src/features/produtos/produto.schema.ts
```

Eles existem para formulário, UX e feedback imediato.

Validação do frontend **não substitui** validação no backend.

---

## 9. Prisma: regras obrigatórias

O Prisma é um reflexo do banco.

Arquivo:

```text
backend/prisma/schema.prisma
```

Gerado/sincronizado com:

```bash
npm run prisma:sync
```

### Não traduzir nomes do banco

Se o Prisma gerar:

```text
produto
vinculo_condominio
pedido_status_historico
```

use esses nomes.

Não transforme em `Product`, `Membership` etc. apenas para ficar em inglês.

### Índices PostgreSQL

Índices funcionais ou parciais podem não aparecer integralmente no Prisma Schema. Não remova nem recrie esses índices só porque o Prisma não os representa.

O DDL/estado real do PostgreSQL continua soberano.

---

## 10. Supabase Auth

Supabase Auth é a fonte de verdade da credencial.

A aplicação nunca grava senha ou hash de senha em `public.usuario`.

O UUID de:

```text
auth.users.id
```

deve ser usado também como:

```text
usuario.id_usuario
```

Por decisão técnica, não existe FK física de `public.usuario` para `auth.users` no DDL, para não obrigar o Prisma a introspectar o schema interno `auth`.

A aplicação deve garantir essa correspondência.

---

## 11. Middleware de autenticação

`middlewares/autenticar.ts` está implementado e executa:

1. extrair `Authorization: Bearer <token>`;
2. validar o JWT emitido pelo Supabase por JWKS;
3. validar assinatura;
4. validar issuer;
5. validar audience;
6. validar expiração;
7. obter o UUID da claim `sub`;
8. localizar `usuario`;
9. negar acesso se `status_conta = SUSPENSA`;
10. verificar se é `super_admin`;
11. se não for super admin, resolver o `vinculo_condominio` ATIVO;
12. anexar o contexto a `req.auth`.

Formato real (`email` e `vinculo_ativo` são opcionais):

```ts
req.auth = {
  id_usuario: "...",
  email: "<EMAIL_VALIDO_DA_CLAIM>", // opcional, normalizado; usado no onboarding
  super_admin: false,
  vinculo_ativo: {
    id_vinculo: "...",
    id_condominio: "...",
    admin_condominio: false,
  },
};
```

---

Usuário de domínio ainda inexistente é permitido antes do onboarding; `usuario.status_conta = SUSPENSA` bloqueia globalmente. Super admin é resolvido na tabela, não em claims de privilégios, e não recebe `vinculo_ativo` neste middleware. JWT valida issuer, audience authenticated, expiração, assinatura ES256/RS256 e sub UUID; as quatro claims são obrigatórias. Perfil/vínculo e papéis de negociação têm autorização própria.

## 12. Isolamento entre condomínios

Regra crítica:

**Nunca confie em `id_condominio` enviado livremente pelo frontend para autorizar acesso.**

O condomínio permitido deve ser derivado do vínculo ATIVO carregado pelo backend.

Errado:

```ts
const produtos = await prisma.produto.findMany({
  where: { id_condominio: req.query.id_condominio },
});
```

Correto conceitualmente:

```ts
const idCondominio = req.auth!.vinculo_ativo!.id_condominio;
```

A query deve filtrar produtos a partir do vínculo do vendedor associado a esse condomínio.

---

## 13. Produto e vitrine

Não existe tabela `loja` no MVP.

A vitrine é derivada de:

- `produto.ativo = true`;
- categoria do produto ativa;
- vínculo do vendedor `ATIVO`;
- vínculo pertencente ao mesmo condomínio do usuário autenticado.

Produto pertence historicamente ao `id_vinculo_vendedor`.

Se o morador mudar de condomínio, produtos antigos não devem ter seu vínculo reescrito; eles devem ser desativados durante a transferência.

---

## 14. Pedido e estoque

Criação de pedido é uma operação transacional.

O service deve validar, dentro do fluxo correto:

1. comprador possui vínculo ATIVO;
2. produto existe e está ativo;
3. vínculo vendedor está ATIVO;
4. comprador e vendedor pertencem ao mesmo condomínio;
5. comprador não está comprando o próprio produto;
6. quantidade > 0;
7. estoque suficiente;
8. `valor_pedido = preco atual * quantidade`;
9. estoque é reservado/descontado;
10. pedido nasce `SOLICITADO`;
11. histórico inicial é criado;
12. conversa 1:1 do pedido é criada;
13. participantes são registrados.

Itens 8 a 13, junto com a reserva de estoque, devem ocorrer de modo atômico por transação Prisma.

Ao mudar para `RECUSADO` ou `CANCELADO`, a devolução de estoque e o histórico devem ocorrer na mesma transação.

---

## 15. Estados do pedido

Transições válidas:

```text
SOLICITADO -> ACEITO       vendedor
SOLICITADO -> RECUSADO     vendedor
SOLICITADO -> CANCELADO    comprador
ACEITO     -> CONCLUIDO    vendedor
ACEITO     -> CANCELADO    comprador
```

Estados terminais:

```text
RECUSADO
CANCELADO
CONCLUIDO
```

Não invente novos estados sem alteração explícita do modelo.

---

## 16. Chat

Chat só existe depois do pedido.

Regras:

- no máximo uma `conversa` por `pedido`;
- participantes normais: comprador e vendedor;
- usuários comuns não leem chats alheios;
- mensagens históricas não são apagadas por encerramento de vínculo;
- conteúdo de mensagem deve ser validado com Zod.

---

## 17. Supabase Storage

Bucket esperado:

```text
product-images
```

Privado.

Fluxo padrão:

```text
frontend
  -> API Express
  -> autenticação/autorização
  -> Supabase Storage com secret key no backend
```

Persistir somente:

```text
produto_imagem.storage_path
```

Não persistir signed URL.

Para exibição, gerar URL assinada temporária.

A `SUPABASE_SECRET_KEY` nunca pode aparecer em código ou variável `VITE_*`.

---

## 18. Estrutura do frontend

```text
frontend/src/
├── components/
│   └── ui/
├── features/
│   ├── auth/
│   ├── onboarding/
│   ├── condominios/
│   ├── produtos/
│   ├── pedidos/
│   ├── chat/
│   ├── administracao/
│   └── perfil/
├── lib/
│   ├── api.ts
│   └── supabase.ts
├── App.tsx
└── main.tsx
```

Cada feature pode conter diretamente:

```text
produto.api.ts
produto.schema.ts
produto.types.ts
```

Crie componentes/páginas conforme a feature crescer; não crie hierarquias profundas sem necessidade.

---

## 19. Frontend e acesso a dados

O frontend pode usar Supabase diretamente para:

- signup;
- login;
- logout;
- obter/renovar sessão.

Dados do domínio devem passar pela API Express:

```text
frontend -> /api/... -> backend -> Prisma -> PostgreSQL
```

Não use:

```ts
supabase.from("produto").select(...)
```

no frontend.

---

## 20. BACKEND IMPLEMENTADO

O prefixo é `/api`. São 28 rotas registradas; tabela extraída das montagens reais dos routers, incluindo chat aninhado. Auth/Supabase controla signup/login/logout/sessão. A solicitação residencial inicial é criada no onboarding; não existe POST /api/vinculos independente. Envio de mensagem usa **/messages**, não /mensagens.

| Método | Rota | Autorização | Objetivo |
| --- | --- | --- | --- |
| GET | `/api/health` | Pública | Saúde |
| GET | `/api/condominios` | JWT, inclusive pré-onboarding/super | Seleção ativa |
| POST | `/api/admin/condominios` | Somente super admin; conta global não suspensa | Cadastrar condomínio ativo com auditoria atômica |
| GET | `/api/vinculos/me` | JWT, inclusive histórico/super | Estado residencial |
| POST | `/api/vinculos/transferencia` | Vínculo ATIVO | Solicitar destino PENDENTE |
| GET | `/api/admin/vinculos` | Admin local do tenant ou super global | Gestão de vínculos |
| PATCH | `/api/admin/vinculos/:id/admin` | Admin local de outro vínculo no tenant ou super | Privilégio local |
| PATCH | `/api/admin/usuarios/:id/status` | Somente super admin | Estado global da conta |
| GET | `/api/admin/vinculos/pendentes` | Admin local do tenant ou super | Fila PENDENTE |
| PATCH | `/api/admin/vinculos/:id/aprovar` | Admin local do alvo/destino ou super | Aprovar vínculo |
| PATCH | `/api/admin/vinculos/:id/rejeitar` | Admin local do alvo/destino ou super | Rejeitar vínculo |
| PATCH | `/api/admin/vinculos/:id/suspender` | Admin local do alvo/destino ou super | Suspender vínculo |
| DELETE | `/api/produtos/:id/imagens/:idImagem` | Dono pelo vínculo ATIVO atual | Excluir objeto exato |
| POST | `/api/produtos/:id/imagens` | Dono pelo vínculo ATIVO atual | Upload privado |
| GET | `/api/produtos/me` | Vínculo ATIVO atual, ownership | Gerir ativos e inativos próprios |
| GET | `/api/produtos/:id` | Vitrine do tenant; próprio ATIVO admite item/categoria inativos; super seleciona condomínio | Detalhe recarregável por ID |
| GET | `/api/produtos` | ATIVO no tenant; super escolhe condomínio ativo | Vitrine do condomínio |
| POST | `/api/produtos` | Vínculo ATIVO atual | Publicar produto |
| PATCH | `/api/produtos/:id/status` | Dono pelo vínculo ATIVO atual | Ativar/desativar produto |
| PATCH | `/api/produtos/:id` | Dono pelo vínculo ATIVO atual | Editar subconjunto não vazio |
| GET | `/api/pedidos/me` | Perfil condômino; todos vínculos próprios, sem exigir ATIVO | Compras/vendas históricas |
| POST | `/api/pedidos` | Comprador ATIVO, vendedor ATIVO, mesmo condomínio; não próprio | Solicitar com reserva |
| PATCH | `/api/pedidos/:id/status` | Comprador/vendedor históricos conforme destino; sem bypass admin | Transição da matriz |
| GET | `/api/pedidos/:id/chat` | Partes históricas ou super; terceiro/admin local alheio negados | Mensagens cronológicas |
| POST | `/api/pedidos/:id/chat/messages` | Somente comprador/vendedor históricos; conversa ATIVA | Enviar mensagem |
| GET | `/api/categorias` | Vínculo ATIVO ou super | Categorias ativas |
| POST | `/api/onboarding` | JWT, sem usuário prévio; não super | Identidade e primeira residência |
| GET | `/api/usuarios/me` | JWT, inclusive sem residência | Identidade/nome próprios |

Todas as protegidas rejeitam conta global suspensa. As duas leituras novas por ID/identidade não ampliam tenant nem ownership. O detalhe permite produto inativo somente ao dono pelo vínculo atual; super seleciona condomínio ativo como na vitrine. Auditoria/histórico não possuem routers públicos próprios.

---

## 21. Erros de domínio

Prefira códigos estáveis, por exemplo:

```text
UNAUTHENTICATED
FORBIDDEN
FORBIDDEN_CROSS_TENANT
MEMBERSHIP_PENDING
MEMBERSHIP_REQUIRED
PRODUCT_NOT_FOUND
INSUFFICIENT_STOCK
INVALID_ORDER_TRANSITION
VALIDATION_ERROR
```

O service lança/retorna erro de domínio; controller/middleware converte para HTTP.

---

## 22. Funcionalidades fora do MVP atual

Não implementar sem solicitação explícita:

- reputação/avaliações;
- geofencing;
- notificações push;
- moderação automática de imagens;
- denúncias/quarentena;
- penalidades globais por CPF;
- capacidade/janelas do vendedor;
- carteira/pagamentos;
- tabela `loja`;
- serviços separados de produtos.

Documentos antigos podem citar esses recursos; o planejamento mais recente os deixou fora do núcleo do MVP.

---

## 23. Como trabalhar ao receber uma tarefa

Antes de codificar:

1. leia este `AGENTS.md`;
2. identifique o módulo envolvido;
3. confira `database/00_ddl_base.sql`;
4. confira o `backend/prisma/schema.prisma` introspectado;
5. não altere o banco se a tarefa não exigir mudança estrutural;
6. respeite routes -> controller -> service -> repository;
7. adicione Zod no `*.schema.ts`;
8. derive condomínio/autoridade do contexto autenticado;
9. preserve regras transacionais;
10. rode TypeScript/build quando possível.

---

## 24. Regra para alterações no banco pelo agente

Se uma tarefa realmente exigir coluna/tabela nova:

1. não edite somente `schema.prisma`;
2. crie um arquivo SQL em:

```text
database/alteracoes/NNN_descricao.sql
```

3. explique que esse SQL deve ser executado no Supabase;
4. depois o usuário deverá rodar:

```bash
npm run prisma:sync
```

5. somente então atualize código dependente do model introspectado.

Se não houver necessidade de alteração estrutural, não crie SQL.

---

## 25. Estado atual e validação de mudanças

O backend principal está implementado: JWT/JWKS, identidade/onboarding, vínculos e administração, categorias, produtos/imagens, pedidos/estoque/histórico, chat, transferência e auditoria administrativa. O frontend possui a infraestrutura do Prompt 23: AuthProvider, cliente HTTP com Bearer, roteamento/guards, login/cadastro/confirmação, onboarding, estado residencial e shells iniciais de morador e super admin. O Prompt 24 acrescenta Vitrine funcional, categorias/busca/filtros/paginação na URL, detalhe por ID/galeria e criação de pedido com confirmação do servidor. O Prompt 25 conclui Meus Produtos, publicação, edição parcial, status e gestão de imagens. O Prompt 26 acrescenta Meus Pedidos, transições por papel, histórico e chat por pedido, inclusive sem residência ATIVA. O Prompt 27 entrega Perfil, solicitação de transferência e administração local/global de vínculos e contas. O Prompt 28 auditou o MVP, corrigiu respostas antigas após troca de identidade, orientou criação de pedido com resposta desconhecida e corrigiu overflow de título longo. Pronto para testes internos controlados, sem homologação remota/produção. A próxima etapa, somente quando solicitada, é homologação com contas de teste e preparação do ambiente de demonstração. Não iniciar recursos adicionais automaticamente.

Antes de alterar, leia os dois documentos em docs e os módulos/testes reais. Depois de qualquer mudança de contrato, atualize o inventário, handoff e esta tabela. Não documentar route placeholder como endpoint registrado. Arquivos antigos em backend/*.md registram suas respectivas etapas; o catálogo atual consolidado está em docs.

Scripts reais: `npm run build` (raiz, ambos os workspaces), `npm run dev` (ambos), e 31 scripts `test:*` em backend/package.json. Não existem scripts genéricos `typecheck` ou `test`. Cada script de teste executa `tsc -p tsconfig.test.json`; use os existentes e não afirme ter rodado scripts ausentes. Integrações usam ONBOARDING_TEST_DATABASE_URL, aceitam somente localhost/127.0.0.1 e banco `porta_onboarding_teste`; nunca apontar para banco de projeto/produção. Storage/JWKS de testes são simulados. Asserções de concorrência exigem PostgreSQL real descartável, não apenas mocks.

## 26. Convenções obrigatórias da API

- Objetos usam `{ dados: {} }`; listas simples, `{ dados: [] }`; DELETE de imagem retorna 204 sem corpo. Health é a exceção explícita com status/projeto.
- Toda listagem paginada usa exatamente `{ "dados": [], "paginacao": {} }`, com pagina/limite/total/total_paginas na raiz. Não criar dados.itens nem dados.paginacao.
- Defaults 1/20 e máximo 100, exceto condomínios (máximo 50) e chat (default 50). Paginar no banco; count/findMany compartilham filtros e snapshot quando aplicável; desempatar por UUID. Não usar N+1.
- Entradas HTTP usadas no service são validadas em schemas Zod do módulo. Escritas têm body estrito, incluindo rejeição de campos de autoridade não previstos. Query ignorada não vira filtro/autoridade.
- Use DTO/select explícitos, sem resposta bruta Prisma. Dinheiro usa Prisma.Decimal e string com duas casas no JSON; nunca floating point para total congelado. Quantidades/estoque são inteiros.
- Timestamps PostgreSQL TIMESTAMPTZ retornam ISO UTC; hora_combinada aceita ISO com offset e deve ser ≥ solicitação. Não alterar horário combinado por rotas de status.
- Erros estáveis são preservados: MEMBERSHIP_REQUIRED e INVALID_ORDER_TRANSITION são os códigos reais, sem renomear para variações dos prompts. Inventário lista os demais e seus HTTP. Prisma/Supabase inesperados retornam erro interno sanitizado; nunca payload, stack ou secrets. JSON inválido retorna 400; JSON acima de 1 MiB, 413 PAYLOAD_TOO_LARGE.
- Não retornar CPF/nascimento/e-mail de moradores. Perfil próprio retorna somente ID/nome/flags; e-mail da credencial pode ser obtido na sessão Auth. storage_path é interno, não um campo público do DTO.

## 27. Invariantes e coordenação entre módulos

- Identity ≠ membership: auth.users.id = usuario.id_usuario = condomino.id_condomino no fluxo normal; credenciais ficam no Auth. Um ATIVO e um PENDENTE por pessoa, garantidos por índices parciais PostgreSQL.
- A relação singular introspectada condomino.vinculo_condominio não representa o histórico. Consultar vinculo_condominio diretamente ao buscar todos os vínculos.
- Produto pertence para sempre ao vínculo vendedor original. Gestão própria exige vínculo ATIVO atual, sem bypass de super admin. Transferência não muda o FK do produto.
- Criar/editar/alterar ativo de produto mantém FOR SHARE no vínculo, revalida estado/identidade e grava na mesma transação. Não remover esse lock: ele coordena com encerramento por transferência/suspensão.
- Pedido guarda comprador histórico e vendedor via produto/vínculo original. Histórico próprio e chat não exigem residência ATIVA atual. Status global SUSPENSA ainda bloqueia tudo protegido.
- Estoque nunca negativo; reserva tem condição estoque suficiente. Valor_pedido é total congelado calculado no servidor. Estados terminais não transicionam. Status/estoque/histórico são atômicos, com UPDATE por ID/estado esperado para evitar dupla restituição.
- Chat só existe após pedido, no máximo uma conversa por pedido; participantes normais são comprador/vendedor reais. Super pode consultar, mas só envia se também for uma das partes. Texto trim 1..1000; conversa ATIVA para enviar; nenhuma marcação de leitura nem encerramento automático por status do pedido.
- Transferência preserva ATIVO antigo enquanto há PENDENTE nova. Aprovação bloqueia SOLICITADO/ACEITO como comprador ou vendedor e último admin sem substituto, salvo intervenção super neste último bloqueio. Produtos antigos inativos, antigo ENCERRADO, novo ATIVO/admin=false, mais auditoria, tudo numa transação.
- Aprovação de transferência mantém FOR UPDATE no antigo antes de buscar pedidos. FOR SHARE de criação de pedido/produto coordena a corrida. Mutex PostgreSQL por condomínio em ordem fixa protege transferências/privilégios e a contagem de substitutos; não trocar por simples pré-checagem.
- Admin local só gerencia seu condomínio; promoção/rebaixamento exige alvo ATIVO e outro vínculo. Super altera status global, sem modificar credenciais Auth, vínculos ou produtos automaticamente. Conta e vínculo são estados separados. Suspensão local mantém seu contrato existente e não é encerramento por transferência.
- Aprovar/rejeitar/suspender, transferir, mudar privilégio e estado global gravam auditoria na transação. No-op de privilégio/estado não duplica auditoria. Ações comuns de usuário não recebem auditoria inventada.
- Storage é privado e acessado pelo backend. Upload JPEG/PNG/WEBP≤5 MiB, path aleatório, upsert=false; persistir só path. Leituras assinam em lote por 600 segundos e podem omitir imagens indisponíveis. Não persistir signed URL.
- Storage e PostgreSQL não são transação distribuída: preservar compensação de upload, retry/log de delete e remoção somente do objeto exato obtido do DB. Não reescrever histórico para contornar falhas.

## 28. Estado atual e próximos trabalhos de frontend

Frontend usa Supabase diretamente apenas para Auth/sessão. Todos os dados do domínio passam pela API Express com `Authorization: Bearer <access_token>`. O cliente em frontend/src/lib/api.ts já injeta esse header, preserva envelopes/paginação, suporta 204/FormData e tenta uma renovação com um retry exclusivamente após 401 UNAUTHENTICATED e novo token da mesma identidade. Não repete escritas por erro de rede ou conflito.

Nunca usar supabase.from() para tabelas de domínio, expor secret/service key em VITE_*, enviar condomínio como autoridade livre, nem enviar valor/preço congelado em pedido como autoridade. IDs de seleção de onboarding/transferência e filtros permitidos são entradas validadas, não autorização. Backend deriva pessoa, vínculo, tenant e papéis.

Consumir [docs/FRONTEND_HANDOFF.md](docs/FRONTEND_HANDOFF.md), com estados de loading/empty/error, formatos e erros reais. Não bloquear histórico/chat por falta de ATIVO; não herdar admin ao transferir. Após aprovação/transferência/privilégio, refazer estado residencial e dados do tenant.

Não há contratos de edição de Perfil, reenviar residência por conta sem ATIVO após rejeição/encerramento, confirmação de leitura, notificações ou pagamentos. Mostrar estado existente e não inventar rotas. Somente implementar essas ações após solicitação e definição de regras. As jornadas dos Prompts 23–27 estão conectadas e foram auditadas no Prompt 28. /admin recebe super e admin local realmente ATIVO; Perfil/Transferência são rotas reais. Não iniciar deploy, infraestrutura ou novos recursos automaticamente.


Frontend implementado no Prompt 23:

- AuthProvider restaura getSession antes dos guards, observa eventos com cleanup, oferece login/cadastro/logout/refresh e usa uma única instância Supabase Auth com persistência e renovação automática.
- EstadoUsuarioProvider lê /usuarios/me e /vinculos/me em paralelo. Limpa/oculta dados ao sair ou trocar identidade, cancela leituras antigas e trata bloqueio global, falhas transitórias e sessão rejeitada.
- resolverEstadoAplicacao centraliza loading, sessão ausente, onboarding, aprovação pendente, ATIVO, histórico indisponível, super, suspensão global e erro. ATIVO + transferência PENDENTE permanece na aplicação atual.
- Rotas: /login, /cadastro, /confirmar-email, /onboarding, /aguardando-aprovacao, /estado-vinculo, /vitrine, /produtos/:id e /admin; / resolve o estado. Guard de super é independente da residência; navegação local futura fica explicitamente desabilitada.
- Formulários usam Zod, erros por campo e dados do backend; seleção de condomínio busca/pagina 20 por vez. Onboarding refaz o estado real após sucesso/conflito, sem fabricar vínculo. Telas de histórico não oferecem ressubmissão inexistente.
- Visual mobile-first terracota/creme, labels, foco visível e alertas acessíveis. O shell global não consulta APIs administrativas; vitrine/detalhe consultam produtos somente para USUARIO_ATIVO.
- Validação do frontend: npm test --workspace frontend (TypeScript e testes Node/tsx já disponível no workspace backend); cenários Chromium opcionais em frontend/tests/fluxos.browser.mjs. Não há lint frontend configurado. Procedimentos e arquivos estão em [docs/FRONTEND_INFRA.md](docs/FRONTEND_INFRA.md).

Frontend implementado no Prompt 24:

- /vitrine funcional: GET /categorias e GET /produtos com limite 20, categorias independentes da listagem, busca trim até 140, id_categoria e pagina em URLSearchParams; mudanças de busca/categoria voltam à página 1. Refresh e back/forward preservam filtros; não enviar id_condominio para o morador.
- /produtos/:id exige USUARIO_ATIVO e usa GET por UUID, inclusive acesso direto/refresh, sem varrer vitrine. Mostra descrição, estoque, categoria, vendedor/moradia e galeria simples. Produto próprio compara vendedor.id_vinculo ao vínculo ATIVO e não oferece pedido.
- Signed URLs ficam apenas em memória/render; imagens[0] é a principal visual, com lazy loading, alt e placeholder em ausência/falha. Não acessar Storage nem persistir URLs.
- Formulário de pedido valida quantidade inteira de 1 até o estoque carregado e data/hora local válida/futura. Converte datetime-local para ISO UTC com timezone explícito. POST /pedidos envia somente id_produto, quantidade e hora_combinada. Totais estimados em centavos servem somente à apresentação; valor confirmado vem do POST.
- Duplo envio bloqueado, sem retry automático por rede/conflito e sem decremento otimista. INSUFFICIENT_STOCK refaz detalhe e ajusta quantidade; PRODUCT_UNAVAILABLE/PRODUCT_NOT_FOUND refazem detalhe; MEMBERSHIP_REQUIRED/FORBIDDEN_CROSS_TENANT refazem estado residencial; erros de horário/validação mantêm campos.
- Confirmação usa o pedido retornado pelo POST, sem GET /pedidos/:id ou link inexistente. Informa SOLICITADO/aguardando vendedor e chat futuro em Meus Pedidos, sem afirmar aceite.
- Nenhuma dependência adicionada nesta etapa. Testes e relatório de arquivos/APIs: [docs/FRONTEND_VITRINE_PEDIDOS.md](docs/FRONTEND_VITRINE_PEDIDOS.md).

Frontend implementado no Prompt 25:

- Rotas /meus-produtos, /meus-produtos/novo e /meus-produtos/:id/editar exigem USUARIO_ATIVO. Navegação real Meus Produtos e link Editar anúncio no detalhe somente para o dono pelo vínculo atual. Admin local não recebe bypass de ownership; super sem residência não publica.
- GET /produtos/me usa dados[] + paginacao raiz, limite 20, busca/id_categoria/ativo/pagina na URL. Ativo omitido inclui ativos/inativos; categoria inativa permanece visível. AbortController descarta leituras antigas e refetch após status usa o filtro atual mesmo se mudou durante a escrita.
- FormularioProduto é compartilhado entre criação/edição. Zod valida campos, preço decimal positivo (string com ponto no payload, até 10 inteiros/2 casas) e estoque number 0..2147483647. POST envia os cinco campos editáveis e navega ao ID retornado; upload aparece somente após existência/ownership conferidos.
- Edição lê o detalhe por UUID e verifica vendedor.id_vinculo antes de mostrar dados no editor. PATCH parcial não vazio envia somente alterações, sem ativo/imagens/autoridade. Categoria atual inativa pode ser mantida omitindo id_categoria; select não troca categoria automaticamente. DTOs de criação/PATCH/listagem/detalhe são distintos.
- Ativar/desativar usa PATCH /produtos/:id/status com apenas boolean ativo; estoque zero permite ativação. Categoria inativa recebe orientação e atualização de categorias. Refetch após PATCH/status não apaga imagens; refetch por imagens/status preserva rascunho não salvo. Após PATCH salvo, GET canônico atualiza a base do formulário, inclusive após retry de leitura falha.
- GerenciadorImagensProduto permite seleção única repetida, prévia blob com revokeObjectURL no cleanup e POST multipart somente imagem (JPEG/PNG/WEBP até 5 MiB). Uma operação por vez no editor, metadata não é tratada como signed URL, e cada sucesso/falha reconcilia GET. Não há limite total de fotos, capa ou reordenação manual.
- Exclusão exige confirmação da foto, usa DELETE sem body/query e aceita 204 sem JSON. IMAGE_NOT_FOUND reconcilia; falhas upload/delete preservam dados e oferecem tentativa explícita. Signed URLs ficam somente em memória; Atualizar imagens/lista renova leituras, sem acesso direto ao Storage.
- MEMBERSHIP_REQUIRED refaz estado residencial e retira editor sem autoridade; PRODUCT_NOT_FOUND mostra erro navegável; categorias/validação e códigos de imagens têm feedback específico. Não há retry automático de escrita por rede/conflito. Auth, providers e API client existentes foram preservados.
- Nenhuma dependência ou alteração backend/banco/contratos. Arquivos, APIs/DTOs e verificações: [docs/FRONTEND_MEUS_PRODUTOS.md](docs/FRONTEND_MEUS_PRODUTOS.md).

Frontend implementado no Prompt 26:

- /pedidos e /pedidos/:id/chat são rotas reais. GuardHistorico exige sessão válida e perfil onboarding_realizado=true/não super, sem depender de ATIVO, inclusive na ausência de residência atual. Erros de sessão/domínio e ACCOUNT_SUSPENDED continuam bloqueando. Guards de vitrine/produtos/criação não foram ampliados. Super não acessa pedidos próprios; chat por ID admite super somente como leitor, sem painel ou envio administrativo.
- Navegação Pedidos substitui o placeholder no shell ativo. /estado-vinculo oferece Meus pedidos anteriores; confirmação do POST de pedido oferece Ver meus pedidos. Shell histórico sem ATIVO não mostra navegação de vitrine/publicação nem inventa condomínio atual.
- GET /pedidos/me usa dados[] + paginacao raiz, pagina/limite 1/20, papel compra/venda e status na URL. Mudanças de filtro reiniciam página 1; refetch após ações preserva filtros e corrige página que ultrapassou o total. AbortController e callback de refetch atual evitam respostas/filtros antigos.
- Cards mostram papel, contraparte/moradia, condomínio original, quantidade, total congelado, horário e histórico cronológico. Não consultam preço atual ou GET /pedidos/:id e não inventam ator de histórico.
- Matriz exata: vendedor SOLICITADO aceita/recusa, vendedor ACEITO conclui; comprador SOLICITADO/ACEITO cancela. Terminais não oferecem ações. Recusa/cancelamento/conclusão têm confirmação; motivo opcional trim até 255, omitido quando vazio. PATCH envia somente status/motivo, com trava por pedido.
- INVALID_ORDER_TRANSITION refaz lista/histórico sem retry de escrita; ORDER_STATUS_FORBIDDEN retira ações e refaz dados; ORDER_NOT_FOUND retira conteúdo indisponível; VALIDATION_ERROR mantém o motivo. Não há estoque/histórico otimista.
- Chat usa GET /pedidos/:id/chat com pagina/limite 1/50 e metadados conversa/pedido na raiz. Ordem ASC preservada; últimas mensagens são a última página, não a primeira. Deep link/refresh não depende de dados do card nem varre pedidos.
- POST /pedidos/:id/chat/messages envia somente conteudo trim 1..1000. Após 201, limpa input e relê a última página, usando IDs reais sem append duplicado. Erros preservam texto e não repetem envio automaticamente. CHAT_CLOSED bloqueia composição e mantém leitura; estado terminal do pedido não fecha chat por inferência.
- Autoria visual usa papel histórico recebido da lista apenas com contexto do mesmo pedido/identidade; acesso direto sem contexto é neutro. Papel do próprio envio pode ser confirmado pelo DTO do POST. Texto React escapado, sem HTML arbitrário, avatars fictícios, realtime ou marcação de leitura. Atualização manual disponível.
- Nenhuma dependência, modificação backend/DDL/Prisma ou alteração de contratos auditados. Arquivos, matriz, guard e verificação: [docs/FRONTEND_PEDIDOS_CHAT.md](docs/FRONTEND_PEDIDOS_CHAT.md).

Frontend implementado no Prompt 27:

- /perfil usa a identidade e residência dos providers existentes, com e-mail somente da própria sessão Auth. Exibe ATIVO, PENDENTE, último vínculo e super sem residência; não oferece edição de dados pessoais. Histórico de pedidos/chat permanece acessível sem ATIVO.
- /perfil/transferencia exige USUARIO_ATIVO e ausência de solicitação pendente. Reutiliza o catálogo paginado, desabilita o condomínio atual e valida moradia trim 1..80. POST envia somente id_condominio/moradia; sucesso ou conflito de vínculo refaz o estado real e volta ao Perfil. Solicitar preserva a residência e vitrine atuais.
- /admin, /admin/vinculos/pendentes e /admin/vinculos compartilham GuardAdmin: super global ou admin_condominio no vínculo realmente ATIVO. Vínculo histórico não concede administração. Local não recebe seletor de tenant nem envia id_condominio; filtro estrangeiro na URL é bloqueado antes da consulta. Super pode selecionar condomínio no catálogo.
- Fila/lista usam DTOs distintos (morador.id_condomino versus morador.id_usuario), dados[] e paginacao raiz, busca/status/pagina na URL e limite 20. Cada leitura usa AbortController; filtros mantidos após mutação e página corrigida quando deixa de existir.
- Aprovar/rejeitar/suspender usam PATCH sem corpo ou Content-Type JSON. Confirmações explicam os impactos; bloqueios OPEN_ORDERS_BLOCK_TRANSFER/LAST_ACTIVE_ADMIN preservam PENDENTE. Não há regra de último admin inventada para suspensão. Privilégio local usa boolean e exclui autoalteração local.
- Somente super vê Suspender conta/Reativar conta na lista geral, com id_usuario. Não se presume status global inicial; resultado confirmado é compartilhado por usuário entre vínculos repetidos, com trava de envio. Reativação global não altera estado residencial.
- Listas sem cache persistente são relidas ao abrir e após ações/conflitos; 403 retira conteúdo administrativo, refaz estado do ator e volta ao Perfil com orientação. Mudança de identidade/residência descarta estado do escopo anterior. Autossuspensão local refaz permissões e preserva acesso histórico.
- Nenhuma dependência ou alteração de backend/banco/contratos. Rotas, APIs, arquivos e verificações: [docs/FRONTEND_PERFIL_ADMINISTRACAO.md](docs/FRONTEND_PERFIL_ADMINISTRACAO.md).

MVP auditado no Prompt 28:

- Inventário atual: 27 operações HTTP e 20 registros React (18 páginas, raiz e fallback). Contratos continuam os auditados; não houve alteração em backend/Prisma/DDL, dependências ou endpoints.
- Correções demonstradas: P1 de recarregarEstado antigo após logout/troca de pessoa; P2 de orientação insuficiente quando o POST de pedido tem resposta desconhecida; P2 de título válido longo causando overflow em 360 px. Nenhum P0/P1 aberto na execução local.
- recarregarEstado deve conferir a identidade atual ANTES de abortar/limpar consultas. Consumidores com escrita em voo devem ignorar conclusões após desmontagem; uma resposta antiga não pode reconsultar/cancelar estado de outra conta.
- POST /pedidos não possui idempotency key. Falha de rede não prova ausência de pedido: preservar formulário, explicar incerteza e orientar conferir Meus Pedidos antes de novo envio, sem retry automático ou sucesso presumido.
- Build da raiz e 29 suítes backend passaram (475 testes: 162 unitários/313 PostgreSQL); 63 testes frontend Node, 159 cenários Chromium e 1 jornada integrada browser/Express/PostgreSQL passaram, total 698. Não há lint frontend configurado.
- frontend/tests/mvp.integrado.browser.mjs exige banco local porta_onboarding_teste e build prévio. Exercita A–F, I, J e K com domínio HTTP/Prisma real e Auth/JWKS/Storage simulados. Não rodar junto com reset de outra suíte; massa única por execução evita confundir contas históricas de teste.
- Browser completo pode usar preview do build com configurações públicas fictícias. Evitar hot reload durante a medição. Mocks de erro de Auth devem respeitar o protocolo/header de versão do SDK instalado; logout entre abas é exercitado pelo Auth real do SDK, sem importar arquivos de src no teste.
- Verificadas 12 telas protegidas nos viewports 360×800, 390×844, 768×1024 e 1280×800, labels/alt/IDs/foco e overflow; leitor de tela, teclado virtual físico e Supabase remoto continuam pendentes de homologação.
- MVP_READY_FOR_USER_TESTING = YES para testes internos controlados; não significa produção/deploy ou configuração remota validada. Evidências, riscos e próximos passos: [docs/MVP_AUDITORIA_FINAL.md](docs/MVP_AUDITORIA_FINAL.md) e [docs/MVP_TESTES_MANUAIS.md](docs/MVP_TESTES_MANUAIS.md). Parar após auditoria/correções.


Cadastro de condomínios implementado no Prompt 29 (16/10/2026):

- Superadmin cadastra condomínios; admin local e morador não cadastram, mesmo por HTTP direto ou com claims/body forjados. POST /api/admin/condominios usa autenticar + exigirSuperAdmin() e autorização repetida no service administrativo.
- Body estrito: nome_residencial trim 1..160, cep exatamente oito dígitos, endereco trim 1..255. Campos extras são rejeitados. Sem unicidade por CEP/nome; sem DDL/alteração Prisma. UUID, ativo=true e created_at usam defaults do banco.
- Retorna 201 {dados:{id_condominio,nome_residencial,cep,endereco,ativo,created_at ISO UTC}}. Erros 400 VALIDATION_ERROR, 401 UNAUTHENTICATED, 403 FORBIDDEN/ACCOUNT_SUSPENDED e 500 INTERNAL_ERROR sanitizado.
- Service coordena criarCondominio e criarAuditoria na mesma transação ReadCommitted. CREATE_CONDOMINIUM usa o ator autenticado e o condomínio criado em entidade_id/id_condominio; metadata somente {ativo:true}. Falha de auditoria reverte criação. Nenhum perfil/vínculo é criado automaticamente.
- /admin/condominios é rota React recarregável, guard somenteSuper e link exclusivo do super em /admin. Consulta o catálogo ativo GET /api/condominios com busca/paginação, sem novo GET administrativo. Formulário Zod normaliza CEP mascarado, usa client Bearer e apenas três campos; trava submit. Após 201 mostra o registro real e refaz busca pelo nome. Resultado incerto de rede/5xx exige conferir catálogo antes de reenvio explícito; nenhum retry automático.
- Seletores de onboarding/transferência não têm cache persistente: releem ao abrir/buscar/atualizar. Primeiro morador recebe PENDENTE/admin=false; super aprova sem admin local prévio e promove explicitamente pelo PATCH existente.
- Novos scripts reais: test:criar-condominio e test:criar-condominio:integration. Integração mantém allowlist local/porta_onboarding_teste. Rotas recontadas pela AST das montagens: 28 HTTP; 21 registros React. Evidências e arquivos em [docs/CONDOMINIOS_SUPERADMIN.md](docs/CONDOMINIOS_SUPERADMIN.md).
- Escopo somente criação/consulta ativa; sem edição, exclusão, desativação, ViaCEP, síndico automático ou deploy. Supabase real continua sujeito à homologação no ambiente de demonstração.
- Validação final do Prompt 29: build/TypeScript passaram; 31 scripts backend, 487 testes (167 unitários/320 PG); frontend Node 64; Chromium 172; jornada integrada 1, total 724, sem falhas/skips finais. Duas fixtures antigas de pedido tiveram data vencida corrigida para 2099, sem alterar regras. Domínio integrado usa PG/Express reais e Auth/JWKS/Storage simulados; Supabase remoto não homologado. MVP continua pronto para a próxima rodada de homologação interna controlada.
