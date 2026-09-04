# Porta-a-Porta — AGENTS.md

## Visão geral

Porta-a-Porta é um marketplace privado entre moradores. Um condomínio é uma fronteira obrigatória de autorização: conhecer um UUID não concede acesso. O repositório usa Next.js App Router, Supabase Auth, Prisma/PostgreSQL, Zod e componentes shadcn/ui.

Este documento descreve o estado atual. Ao implementar algo novo, mantenha os guardrails de segurança mesmo quando a tela ou endpoint correspondente ainda não existir.

## Estado atual

Implementado atualmente:

- Autenticação Supabase SSR com cookies, login, cadastro, logout e sessão atual.
- API de condomínios, apartamentos, vínculos, produtos, carrinho, checkout, pedidos, categorias e perfil.
- Autorização dinâmica por banco para os papéis `member`, `admin` e `superadmin`.
- Frontend inicial com login, cadastro, perfil e portal responsivo; a vitrine consulta a API real.
- Área unificada `/administracao` para admins e superadmins, com gestão de condomínios, moradias, moradores, produtos, contas públicas, administradores e convites.

Pendências conhecidas:

- As páginas de carrinho, pedidos e vendedor ainda exibem estados iniciais/placeholder; não trate seus CRUDs de interface como concluídos.
- Não há suíte automatizada de testes no repositório.

## Stack

- Next.js 16.3.4 com App Router e Turbopack.
- React 19.2.8 e TypeScript strict.
- Tailwind CSS 4, `tw-animate-css`, shadcn/ui 4 e `lucide-react`.
- Prisma 7.10.0 com `@prisma/adapter-pg` e PostgreSQL hospedado no Supabase.
- `@supabase/supabase-js` 2 e `@supabase/ssr`.
- Zod 4.5.4.

Não há React Hook Form, Sonner, React Query ou SWR instalados. Não os adicione por conveniência.

## Estrutura

```text
app/
  api/                         Route Handlers
  condominios/[condominioId]/  Páginas autenticadas por condomínio
  login/ register/             Autenticação
  me/perfil/                   Perfil próprio
components/
  ui/                          Componentes shadcn locais
  auth-form.tsx                Formulário de login/cadastro
  portal.tsx                   Shell autenticado e vitrine
lib/
  auth/                        Contexto e helpers de autorização
  db/prisma.ts                 Prisma Client
  repositories/                Acesso aos dados de negócio
  validations/                 Schemas Zod
  dtos/                        Contratos de saída seguros
  supabase/                    Clientes browser/server e proxy SSR
prisma/schema.prisma           Schema multi-schema introspectado
prisma7.config.ts              Configuração Prisma CLI
proxy.ts                       Renovação SSR de sessão
```

Route Handlers coordenam autenticação, autorização, validação, repository e DTO. Não use Prisma em Client Components nem duplique queries de autorização em rotas.

## Rotas HTTP

Todos os segmentos dinâmicos usam nomes semânticos. Não recrie `app/api/condominios/[id]`: o item de condomínio é `[condominioId]`.

| Grupo | Rotas e métodos atuais |
| --- | --- |
| Auth | `POST /api/auth/register`, `/login`, `/logout`; `GET /api/auth/me` |
| Categorias | `GET /api/categorias` para usuário autenticado |
| Condomínios | `GET, POST /api/condominios`; `GET, PATCH, DELETE /api/condominios/[condominioId]` |
| Apartamentos | `GET, POST /api/condominios/[condominioId]/apartamentos`; `GET, PATCH, DELETE .../[apartamentoId]` |
| Membros | `GET, POST /api/condominios/[condominioId]/membros`; `GET, PATCH, DELETE .../[vinculoId]` |
| Produtos | `GET, POST /api/condominios/[condominioId]/produtos`; `GET, PATCH, DELETE .../[produtoId]` |
| Carrinho | `GET .../carrinho`; `POST .../itens`; `PATCH, DELETE .../itens/[itemId]`; `POST .../checkout` |
| Pedidos | `GET .../pedidos`; `GET, DELETE .../[pedidoId]`; `PATCH .../[pedidoId]/status` |
| Perfil | `GET, PATCH /api/me/perfil` |
| Administração | `GET /api/administracao/usuarios`; `DELETE /api/administracao/usuarios/[usuarioId]` somente para superadmin |
| Administradores | `GET, POST /api/superadmin/administradores`; `DELETE .../[administradorId]`; `DELETE .../convites/[conviteId]` |

O `DELETE` de pedido retorna 405. Não há PUT no projeto; prefira PATCH.

## Autenticação Supabase

Supabase Auth é a única autoridade de autenticação.

- `lib/supabase/client.ts` cria o cliente browser com `createBrowserClient`.
- `lib/supabase/server.ts` cria o cliente server com `createServerClient` e cookies de `next/headers`.
- `proxy.ts` chama `updateSession()` de `lib/supabase/proxy.ts`; o utilitário usa `supabase.auth.getClaims()` para renovar cookies de sessão.
- `requireAuth()` também usa `getClaims()`, obtém `sub` e consulta `public.usuarios`; conta inativa retorna 403.
- Login usa `signInWithPassword`, cadastro usa `signUp`, logout usa `signOut`. `/api/auth/me` retorna DTO seguro.

Não crie JWT próprio, secrets de JWT, refresh endpoint paralelo, armazenamento de token em localStorage, senha no schema `public` ou service-role key em `NEXT_PUBLIC_*`.

## Autorização

Helpers em `lib/auth/index.ts`:

- `requireAuth()`: valida a identidade e `usuarios.ativo`.
- `getAuthContext(condominioId?)`: resolve usuário, papel e vínculo quando houver condomínio.
- `requireCondominiumAccess(condominioId)`: exige acesso; fora do escopo retorna 404.
- `requireCondominiumAdmin(condominioId)`: exige admin do condomínio ou superadmin.
- `requireSuperadmin()`: exige superadmin ativo.
- `requireActiveMembership(condominioId)`: exige vínculo de morador ativo, inclusive para vender, carrinho e checkout.
- `requireResourceOwnerOrAdmin()`: helper disponível para recursos cuja propriedade seja do usuário.

A resolução em `lib/repositories/auth.repository.ts` consulta o PostgreSQL a cada requisição. Prioridade: `superadmin > admin > member`.

- Superadmin: registro ativo em `superadmins`; é global, mas não ganha vínculo de morador.
- Admin: registro ativo em `usuario_condominios_admin` para aquele condomínio.
- Member: `usuarios.condomino_id` com `condomino_apartamentos` ativo no condomínio, em apartamento e condomínio ativos.

## Matriz de permissão

| Ação | Member | Admin local | Superadmin |
| --- | --- | --- | --- |
| Consultar condomínio acessível e conteúdo | Sim | Sim | Sim |
| Consultar outro condomínio | Não | Não | Sim |
| Criar produto | Com vínculo ativo | Somente se também member | Somente se também member |
| Alterar/desativar produto próprio | Sim | Sim | Sim |
| Alterar produto de terceiro | Não | No próprio condomínio | Sim |
| Consultar ou alterar carrinho | Somente próprio, com vínculo | Nunca carrinho de terceiro | Nunca carrinho de terceiro |
| Consultar pedidos | Compra ou venda própria | Todos do condomínio | Todos |
| Alterar status | Somente vendedor | Sim | Sim |
| Criar/remover vínculo ou apartamento | Não | Sim, local | Sim |
| Criar condomínio | Não | Não | Sim |
| Alterar condomínio | Não | Somente os administrados | Sim |
| Desativar condomínio | Não | Não | Sim |
| Conceder/revogar admin | Não | Não | Sim |
| Conceder/revogar superadmin | Sem API | Sem API | Manual no Supabase |
| Desativar conta global | Não | Não | Sim, por soft disable |

Frontend serve apenas para UX. A API continua sendo a autoridade.

## Multi-tenancy e IDOR/BOLA

Para todo recurso de condomínio:

1. Validar UUIDs e query/body com Zod.
2. Autenticar e validar acesso ao `condominioId`.
3. Verificar papel ou ownership necessário.
4. Consultar e alterar usando também `condominio_id`, quando aplicável.
5. Retornar 404 para recursos inexistentes ou fora de escopo.

Nunca aceite como autoridade campos enviados pelo cliente, como `condominio_id`, `usuario_id`, `condomino_id`, comprador, vendedor, vínculo, papel ou ownership. Derive-os da sessão, URL validada e banco.

Não troque uma query escopada por `findUnique({ where: { id } })` em recursos multi-tenant.

## Banco e Prisma

O schema usa PostgreSQL com schemas `public` e `auth`. `auth.users` é tabela externa do Supabase, configurada em `prisma7.config.ts` com `externalTables: ["auth.users"]`. Não criar, alterar, migrar ou apagar tabelas do schema `auth`.

`prisma7.config.ts` usa `DIRECT_URL` para comandos CLI. A aplicação cria Prisma Client com `DATABASE_URL` e `PrismaPg` em `lib/db/prisma.ts`.

Modelo conceitual:

```text
condominios -> apartamentos
condominos <-> apartamentos via condomino_apartamentos
usuarios -> auth.users e, opcionalmente, condominos
usuarios <-> condominios via usuario_condominios_admin
usuarios -> superadmins
condomino_apartamentos -> produtos e carrinhos
carrinhos -> carrinho_itens
pedidos -> pedido_itens
```

`condominos` representa a pessoa; `usuarios` representa a conta autenticada; `condomino_apartamentos` é o vínculo de moradia. `pedidos` têm comprador e vendedor por vínculo; checkout pode criar um pedido por vendedor.

Enums de negócio: `status_carrinho` (`aberto`, `finalizado`), `status_pedido` (`solicitado`, `aceito`, `recusado`, `concluido`) e `tipo_vinculo_moradia` (`proprietario`, `inquilino`).

O schema contém RLS, check constraints, índices parciais e detalhes de triggers que Prisma não representa integralmente. Após `prisma db pull`, confira manualmente que `condomino_apartamentos` ainda expõe `carrinhos[]`.

## Histórico, exclusão e checkout

- Condomínio, apartamento e produto usam `ativo=false` e `desativado_em`.
- Vínculo usa `ativo=false` e `desvinculado_em`.
- Admin e superadmin possuem `ativo` e `revogado_em`. Somente superadmin pode conceder/revogar admin pela aplicação; superadmin nunca é concedido ou revogado pela API.
- Usuário global usa `ativo=false` e `desativado_em`; admin local apenas desativa vínculos de morador.
- Pedido e `pedido_itens` nunca são removidos.
- Itens de carrinho são temporários e podem sofrer hard delete.
- Remover vínculo desativa produtos associados e limpa esses produtos somente de carrinhos abertos, preservando pedidos e histórico.

`checkoutCarrinho()` vive em `lib/repositories/pedidos.repository.ts` e usa transação. Ele revalida produto ativo, estoque, vendedor ativo, condomínio e compra própria; agrupa itens por vendedor, cria um pedido por vendedor, grava snapshot de `nome_produto` e `preco_unitario`, decrementa estoque com `updateMany` condicional e finaliza o carrinho. Estoque insuficiente vira 409 e deve causar rollback.

Transições permitidas: `solicitado -> aceito|recusado`; `aceito -> concluido`. Outras retornam 409.

## Validações, DTOs e erros

Entradas externas usam schemas em `lib/validations`:

- `auth.ts`, `condominios.ts`, `apartamentos.ts`, `membros.ts`, `produtos.ts`, `carrinho.ts`, `pedidos.ts` e `perfil.ts`.
- `common.ts` reúne `uuidSchema`, paginação, booleanos de query, preço, estoque e quantidade.

Use `.strict()` para bodies sensíveis, `.trim()` para texto e schemas PATCH explícitos que exigem ao menos um campo. Não faça mass assignment.

Respostas de sucesso usam normalmente `{ data: ... }`; coleções paginadas também incluem `page`, `limit`, `total` e `totalPages`. Erros de `lib/http/errors.ts` usam `{ error, details? }`. Status usados: 200, 201, 204, 400, 401, 403, 404, 405, 409 e 500.

Use DTOs em `lib/dtos`; não envie objetos Prisma completos, email de terceiros ou dados internos do Supabase.

## Frontend

Páginas atuais:

- `/`: `Portal` autenticado.
- `/login` e `/register`: `AuthForm` conectado à API.
- `/me/perfil`: consulta e altera somente dados pessoais permitidos.
- `/me/perfil` funciona também quando `usuarios.condomino_id` é `null`, exibindo conta e acesso administrativo sem tratar a ausência de perfil de morador como erro.
- `/administracao`: landing com as opções Condomínios e Usuários para admin/superadmin.
- `/administracao/condominios`: superadmin vê todos e pode criar/desativar; admin vê e edita somente os que administra.
- `/administracao/usuarios`: superadmin gerencia contas/admins globalmente; admin gerencia apenas moradores e vínculos do condomínio selecionado.
- `/condominios/[condominioId]/produtos`: vitrine com busca e dados reais.
- `/condominios/[condominioId]/carrinho`, `pedidos`, `vendedor`, `admin`, `admin/moradores` e `admin/apartamentos`: estrutura atual do portal, ainda sem CRUD de interface completo.

`components/portal.tsx` contém header, navegação responsiva, seletor de condomínio e regras visuais de menu. Não use essa visibilidade como mecanismo de segurança. Comprador e vendedor não são roles globais: a mesma pessoa pode comprar e vender conforme vínculo e ownership.

`components.json` configura shadcn/ui com aliases `@/components`, `@/components/ui` e `@/lib`. Reutilize os componentes existentes em `components/ui` e use `lucide-react` para ícones. Não recrie uma biblioteca visual paralela e não transforme toda a aplicação em Client Components.

Tokens visuais atuais em `app/globals.css`: primário `#7B1429`, fundo `#EEE5DE`, sidebar/secundário `#D9CCC3` e texto `#3B2B30`. Use tokens CSS/Tailwind sem espalhar novos HEX arbitrários.

## Variáveis de ambiente

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `DATABASE_URL`
- `DIRECT_URL`

Mantenha `.env` fora do Git. `.env.example` contém apenas placeholders. Nunca imprima valores reais, tokens, senhas, URLs de conexão ou secrets.

## Convenções e segurança

- TypeScript strict; não use `any` ou `as any`.
- Prefira funções pequenas e imports por `@/`.
- Todo acesso Prisma de negócio deve ficar em `lib/repositories`.
- Não adicione dependências sem necessidade real.
- Não registre senha, token ou segredo em logs.
- Não use `window.confirm`; quando implementar ações destrutivas no frontend, use o componente shadcn apropriado.
- Não criar endpoint de refresh, concessão/revogação de superadmin ou DELETE de pedidos.
- Nunca hard-delete `usuarios`, `condominos`, condomínios, vínculos administrativos ou histórico comercial. Revogação/desativação administrativa é sempre soft.
- Superadmin pode pré-autorizar admin por email em `convites_admin`; admin comum não pode conceder nem revogar admin.
- Admin pode alterar somente os campos administrativos seguros dos condomínios em que possui `usuario_condominios_admin.ativo=true`; somente superadmin cria ou desativa condomínios.

Nunca execute sem confirmação explícita: `prisma migrate reset`, `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, reset do Supabase, deleção em massa, alteração destrutiva de migrations ou alteração do schema `auth`.

## Git e comandos

`.gitignore` ignora `.env*` (exceto `.env.example`), `.next/`, `node_modules/` e `lib/generated/prisma`. Preserve alterações não relacionadas no worktree.

Comandos:

```bash
npm run dev
npm run lint
npm run build
npx prisma format
npx prisma validate
npx prisma generate
```

Antes de concluir código, execute no mínimo format, validate, generate, lint e build. Execute testes existentes quando houver.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
