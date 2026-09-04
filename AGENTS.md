# Porta-a-Porta — AGENTS.md

## Objetivo do projeto

Porta-a-Porta é um marketplace privado entre moradores de condomínios.

O sistema é multi-tenant:

- cada condomínio é uma fronteira de autorização;
- um usuário pode ser membro de vários condomínios;
- um usuário pode administrar vários condomínios;
- um administrador só possui poderes administrativos nos condomínios aos quais está vinculado;
- um superadmin possui acesso administrativo global;
- conhecer um UUID nunca é suficiente para acessar um recurso.

## Stack

- Next.js com App Router
- TypeScript strict
- React
- Prisma
- PostgreSQL hospedado no Supabase
- Supabase Auth
- Zod
- shadcn/ui

## Estrutura esperada

- `app/api`: Route Handlers HTTP
- `lib/db`: Prisma Client
- `lib/repositories`: acesso ao banco
- `lib/validations`: schemas Zod
- `lib/auth`: autenticação, contexto e autorização
- `lib/supabase`: clientes Supabase de browser/server e utilitários SSR

Antes de criar novas pastas ou abstrações, inspecione e reutilize a estrutura existente.

Não acessar Prisma diretamente a partir de Client Components.

## Banco e Prisma

- Prisma é a camada de acesso aos dados de negócio em `public`.
- Supabase hospeda o PostgreSQL e gerencia o schema `auth`.
- `auth.users` pertence ao Supabase e é external table para o Prisma.
- Não criar, alterar, dropar ou migrar tabelas do schema `auth`.
- `public.usuarios.id` corresponde ao `auth.users.id`.
- O datasource usa os schemas `public` e `auth` apenas porque existem FKs entre eles.
- Não colocar credenciais, senhas ou connection strings no código.
- Não executar reset de banco, `DROP`, exclusão de coluna ou migration destrutiva sem confirmação explícita.

Após `prisma db pull`, conferir manualmente se a relação de `condomino_apartamentos` com carrinhos continua 1:N (`carrinhos[]`) caso o índice parcial cause introspecção incorreta.

## Variáveis de ambiente

Esperadas:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `DATABASE_URL`
- `DIRECT_URL`

Regras:

- nunca criar JWT secrets próprios;
- nunca criar `NEXT_PUBLIC_*` contendo segredo administrativo;
- nunca expor secret/service-role key no browser;
- não imprimir valores reais de `.env` em logs ou respostas;
- manter `.env` fora do Git;
- `.env.example` deve conter apenas nomes e placeholders.

## Autenticação

Supabase Auth é a única autoridade de autenticação.

Não implementar JWT próprio.
Não criar `JWT_ACCESS_SECRET`.
Não criar `JWT_REFRESH_SECRET`.
Não armazenar senha no schema `public`.

Usar o JWT emitido pelo Supabase apenas para estabelecer a identidade autenticada.

No servidor:

- preferir `supabase.auth.getClaims()` para validar o JWT;
- usar `supabase.auth.getUser()` quando for necessário obter o usuário atual diretamente do Auth server;
- não usar `getSession()` como prova de autorização;
- não confiar em claims de papel do cliente para decidir permissões de condomínio.

A autorização deve ser consultada dinamicamente no PostgreSQL para que revogações tenham efeito imediato.

## Estado da conta

Toda requisição autenticada deve confirmar que `public.usuarios.ativo = true`.

Se a conta estiver inativa:

- retornar 403;
- não confiar apenas na expiração do JWT.

## Papéis

Papéis efetivos:

1. `superadmin`
2. `admin`
3. `member`

### Superadmin

Existe quando houver registro ativo em `public.superadmins`.

- acesso administrativo global;
- pode consultar qualquer condomínio;
- não ganha automaticamente o direito de anunciar produto: para vender, também deve ser membro do condomínio;
- não criar API pública para conceder/revogar superadmin;
- concessão/revogação é feita manualmente no Supabase.

### Admin

Existe quando houver registro ativo em `public.usuario_condominios_admin` para o condomínio solicitado.

- papel sempre específico por condomínio;
- admin do Condomínio A não é admin do Condomínio B;
- pode administrar recursos do condomínio ao qual está vinculado como admin;
- para vender produto próprio, também precisa ser membro;
- não criar API pública para conceder/revogar admin;
- concessão/revogação é feita manualmente no Supabase.

### Member

Um usuário é membro quando:

- `usuarios.condomino_id` aponta para um `condominos`;
- existe pelo menos um `condomino_apartamentos` ativo desse condômino no condomínio solicitado.

Um membro pode estar vinculado a vários apartamentos e vários condomínios.

## Contexto de autorização

Centralizar as regras em helpers reutilizáveis, evitando lógica duplicada.

Preferir funções equivalentes a:

- `requireAuth()`
- `getAuthContext()`
- `requireCondominiumAccess(condominioId)`
- `requireCondominiumAdmin(condominioId)`
- `requireSuperadmin()`
- `requireResourceOwnerOrAdmin(...)`

Um contexto de autorização deve ser capaz de representar:

- `userId`
- `condominoId`
- `condominioId`, quando aplicável
- papel efetivo naquele condomínio: `member | admin | superadmin`

A prioridade de papel é:
`superadmin > admin > member`.

## Regra multi-tenant crítica

Toda operação referente a um condomínio deve validar acesso ao condomínio antes de retornar dados.

Nunca confiar em `condominio_id`, `usuario_id`, `comprador_id`, `vendedor_id`, papel ou ownership enviados pelo cliente.

Preferir rotas aninhadas:

- `/api/condominios/[condominioId]/produtos`
- `/api/condominios/[condominioId]/apartamentos`
- `/api/condominios/[condominioId]/membros`
- `/api/condominios/[condominioId]/pedidos`

Mesmo após validar acesso, queries de recursos multi-tenant devem filtrar também por `condominio_id` quando aplicável.

Não usar somente `findUnique({ where: { id } })` para recurso multi-tenant se isso permitir descobrir/acessar um objeto de outro condomínio.

Evitar IDOR/BOLA.

Quando um recurso existe, mas está fora do escopo acessível do usuário, preferir 404 para não revelar sua existência.

## Matriz de autorização

### Condomínios

Member:

- vê apenas condomínios dos quais é membro.

Admin:

- vê os condomínios que administra;
- também vê condomínios dos quais é membro.

Superadmin:

- vê todos.

Criar condomínio:

- somente superadmin.

Alterar condomínio:

- somente superadmin.

Remover condomínio:

- somente soft delete por superadmin.

### Conteúdo geral do condomínio

Membro, admin daquele condomínio e superadmin podem consultar conteúdo normal do marketplace daquele condomínio.

Um membro/admin de outro condomínio não pode consultar o conteúdo.

### Produtos

GET:

- member/admin/superadmin daquele condomínio.

POST:

- somente quem também for membro daquele condomínio;
- vendedor deve ser derivado do usuário autenticado;
- nunca confiar em `vendedor_vinculo_id` arbitrário do body.

PATCH:

- dono do produto;
- admin daquele condomínio;
- superadmin.

DELETE:

- dono do produto;
- admin daquele condomínio;
- superadmin;
- sempre soft delete (`ativo=false`, `desativado_em=now()`).

Produtos inativos:

- não aparecem na vitrine;
- não podem entrar em novos carrinhos/pedidos.

### Carrinho

Carrinho é privado.

Somente o próprio comprador pode:

- consultar;
- adicionar item;
- alterar quantidade;
- remover item.

Admin e superadmin não devem editar carrinhos de terceiros.

Itens de carrinho são temporários e podem ser removidos fisicamente.

### Pedidos

GET:

- comprador vê seus pedidos;
- vendedor vê pedidos recebidos;
- admin vê pedidos do condomínio;
- superadmin vê todos.

PATCH de status:

- vendedor;
- admin daquele condomínio;
- superadmin.

Transições válidas:

- `solicitado -> aceito`
- `solicitado -> recusado`
- `aceito -> concluido`

DELETE:

- proibido para todos;
- pedido e `pedido_itens` são histórico;
- se houver route DELETE, retornar 405.

### Dados de condômino

Dados privados:

- próprio usuário;
- admin do condomínio no qual a pessoa está vinculada, dentro do escopo administrativo necessário;
- superadmin.

Não expor para membros comuns:

- email de terceiros;
- dados internos do Supabase Auth;
- data de nascimento de terceiros;
- carrinhos de terceiros;
- pedidos privados de terceiros.

Usar DTOs explícitos.

### Vínculo de morador

Criar vínculo:

- admin daquele condomínio;
- superadmin.

Remover vínculo:

- admin daquele condomínio;
- superadmin;
- saída voluntária do próprio membro somente se a regra de negócio estiver explicitamente implementada e segura.

Nunca remover a pessoa global (`condominos`) para retirá-la de um condomínio.

Remoção do condomínio significa soft removal em `condomino_apartamentos`.

### Apartamentos

GET:

- member/admin/superadmin daquele condomínio.

POST/PATCH:

- admin daquele condomínio;
- superadmin.

DELETE:

- soft delete;
- admin daquele condomínio ou superadmin;
- não desativar se houver vínculo ativo incompatível; retornar 409.

### Admin e superadmin

Não criar endpoints para:

- conceder admin;
- revogar admin;
- conceder superadmin;
- revogar superadmin.

Essas operações são manuais no Supabase.

## Soft delete e histórico

Hard delete é proibido quando puder quebrar histórico comercial ou FKs.

Usar soft delete/desativação para:

- condomínios;
- apartamentos;
- vínculos de morador;
- produtos;
- contas da aplicação quando aplicável;
- permissões de admin/superadmin quando aplicável.

Nunca hard-delete:

- pedidos;
- `pedido_itens`;
- produtos que participam de histórico;
- condôminos/vínculos necessários para histórico comercial.

Ao remover um morador de um condomínio:

- desativar o vínculo (`ativo=false`, `desvinculado_em=now()`);
- desativar produtos ligados àquele vínculo;
- remover esses produtos de carrinhos abertos quando apropriado;
- preservar pedidos e `pedido_itens`;
- usar transação;
- se houver estado comercial em andamento que torne a operação insegura, retornar 409.

Desativar a conta do usuário não deve apagar automaticamente o registro de `auth.users` nem o histórico comercial.

## Checkout e estoque

Checkout deve ser transacional.

No checkout:

- validar novamente que produto está ativo;
- validar vendedor/vínculo;
- validar mesmo condomínio;
- impedir compra própria;
- validar estoque;
- copiar `nome_produto` e `preco_unitario` para `pedido_itens`;
- criar um pedido por vendedor;
- decrementar estoque atomicamente;
- impedir estoque negativo.

Se estoque ficar insuficiente por concorrência:

- abortar a transação;
- retornar 409.

## API

Padrão:

- `route.ts`: GET coleção / POST;
- `[id]/route.ts`: GET / PATCH / DELETE somente quando permitido.

Rotas de autenticação esperadas:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Não criar endpoint de refresh apenas para duplicar o refresh de sessão do Supabase SSR.

Validar params, query e body com Zod.

Não fazer mass assignment.
PATCH deve aceitar somente campos explicitamente autorizados.

## Status HTTP

Usar consistentemente:

- 200: sucesso
- 201: criado
- 204: sucesso sem corpo
- 400: request inválida
- 401: não autenticado/JWT inválido
- 403: autenticado sem permissão
- 404: recurso inexistente ou fora do escopo acessível
- 409: conflito de estado/estoque/integridade/regra de negócio
- 422: validação quando apropriado
- 405: operação não permitida
- 500: erro inesperado

Não vazar detalhes internos do banco, stack traces ou secrets.

## Repositories e separação de responsabilidades

Todo acesso Prisma deve ficar em `lib/repositories` ou na camada já equivalente no projeto.

Route Handlers devem coordenar:

1. autenticação;
2. autorização;
3. validação;
4. regra de negócio;
5. repository;
6. DTO/response.

Evitar queries Prisma complexas diretamente em `route.ts`.

Não criar abstrações excessivas, mas não duplicar lógica crítica de segurança.

## Supabase SSR

Usar o padrão atual do Supabase para Next.js App Router.

- `@supabase/supabase-js`
- `@supabase/ssr`
- cliente browser e server separados;
- sessão em cookies;
- mecanismo de Proxy/Middleware conforme a versão de Next.js instalada;
- validar identidade no servidor com `getClaims()`.

Antes de implementar, verificar as versões realmente instaladas e seguir o padrão compatível.

## Código

- TypeScript strict.
- Não usar `any`.
- Não usar `as any`.
- Preferir funções pequenas.
- Não adicionar dependências sem necessidade.
- Reutilizar padrões existentes.
- Não deixar TODO de segurança.
- Não silenciar erros TypeScript/ESLint.
- Não adicionar mocks de credenciais.
- Não logar tokens, senhas ou secrets.

## Segurança

Antes de implementar qualquer endpoint, revisar:

- autenticação;
- autorização;
- isolamento entre condomínios;
- IDOR/BOLA;
- ownership;
- mass assignment;
- exposição de PII;
- integridade histórica;
- concorrência de estoque.

Autorização no frontend é apenas UX.
A API deve repetir todas as verificações.

## Antes de concluir alterações

Executar, no mínimo:

```bash
npx prisma format
npx prisma validate
npx prisma generate
npm run lint
npm run build
```

Se houver suíte de testes existente, executá-la também.

Corrigir erros causados pelas alterações antes de concluir.

Ao finalizar, informar de forma objetiva:

- arquivos criados;
- arquivos alterados;
- endpoints adicionados;
- regras de autorização implementadas;
- comandos/testes executados;
- pendências reais.
