# Banco de dados

Ordem para um projeto Supabase novo:

1. `00_ddl_base.sql` — cria enums, tabelas, FKs, checks, índices e RLS.
2. `01_usuario_prisma.sql` — cria/atualiza o usuário PostgreSQL `prisma` e concede permissões.
3. `02_seed_categorias.sql` — opcional; adiciona categorias iniciais.

O projeto adota **database-first**:

- mudanças estruturais são feitas primeiro no Supabase/SQL;
- depois execute `npm run prisma:sync`;
- `prisma db pull` atualiza `backend/prisma/schema.prisma` a partir do banco;
- não renomeie models/campos do Prisma nem adicione `@map`/`@@map` sem uma necessidade explícita.
