# Porta-a-Porta

## Stack

- Next.js App Router
- TypeScript
- React
- Prisma
- PostgreSQL hospedado no Supabase
- Zod para validação
- shadcn/ui no frontend

## Estrutura

- Rotas HTTP ficam em `app/api`
- Acesso ao banco fica em `lib/repositories`
- Prisma Client fica em `lib/db`
- Validações Zod ficam em `lib/validations`
- Não acessar Prisma diretamente a partir de Client Components

## Banco de dados

- Prisma é a camada de acesso ao PostgreSQL
- O Supabase hospeda o PostgreSQL
- `schema.prisma` representa o schema da aplicação
- Não colocar credenciais ou connection strings no código

## API

Para cada recurso:

- `route.ts`: GET da coleção e POST
- `[id]/route.ts`: GET, PATCH e DELETE
- Validar entradas com Zod
- Retornar códigos HTTP apropriados

## Código

- Usar TypeScript strict
- Evitar `any`
- Preferir funções pequenas
- Não adicionar dependências sem necessidade
- Seguir a estrutura existente antes de criar novas camadas

## Antes de concluir alterações

Executar:

npm run lint
npm run build
