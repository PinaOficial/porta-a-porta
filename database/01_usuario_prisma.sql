-- ============================================================
-- PORTA A PORTA - USUÁRIO POSTGRESQL PARA O PRISMA
--
-- 1) TROQUE a senha abaixo antes de executar.
-- 2) Use a mesma senha na DATABASE_URL do backend/.env.
-- 3) Execute DEPOIS de 00_ddl_base.sql.
-- ============================================================

-- Para um trabalho acadêmico, uma senha longa alfanumérica é mais
-- simples de copiar para a URL. Se usar caracteres especiais, eles
-- precisam ser percent-encoded na connection string.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prisma') THEN
    CREATE ROLE prisma
      LOGIN
      PASSWORD 'TROQUE_POR_UMA_SENHA_FORTE'
      BYPASSRLS
      CREATEDB;
  ELSE
    ALTER ROLE prisma
      WITH LOGIN
      PASSWORD 'TROQUE_POR_UMA_SENHA_FORTE'
      BYPASSRLS
      CREATEDB;
  END IF;
END
$$;

grant prisma to postgres;

grant usage on schema public to prisma;
grant create on schema public to prisma;

grant all on all tables in schema public to prisma;
grant all on all routines in schema public to prisma;
grant all on all sequences in schema public to prisma;

alter default privileges for role postgres in schema public
  grant all on tables to prisma;

alter default privileges for role postgres in schema public
  grant all on routines to prisma;

alter default privileges for role postgres in schema public
  grant all on sequences to prisma;
