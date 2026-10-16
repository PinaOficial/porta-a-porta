-- ============================================================
-- PORTA A PORTA - DDL BASE
-- Banco: Supabase PostgreSQL
-- Estratégia: database-first; este arquivo é a fonte inicial
-- de verdade para o esquema relacional do projeto.
--
-- EXECUTAR UMA VEZ em um projeto Supabase novo.
-- Depois de alterações no banco, sincronize o Prisma com:
--   npm run prisma:sync
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- ENUMS
-- ------------------------------------------------------------

create type status_conta_enum as enum (
  'ATIVA',
  'SUSPENSA'
);

create type status_vinculo_enum as enum (
  'PENDENTE',
  'ATIVO',
  'REJEITADO',
  'SUSPENSO',
  'ENCERRADO'
);

create type status_pedido_enum as enum (
  'SOLICITADO',
  'ACEITO',
  'RECUSADO',
  'CANCELADO',
  'CONCLUIDO'
);

create type status_conversa_enum as enum (
  'ATIVA',
  'ENCERRADA'
);

-- ------------------------------------------------------------
-- IDENTIDADE
-- ------------------------------------------------------------

create table usuario (
  id_usuario uuid primary key,
  email varchar(320) not null,
  status_conta status_conta_enum not null default 'ATIVA',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column usuario.id_usuario is
  'Deve possuir o mesmo UUID de auth.users.id. A relação é garantida pela aplicação para evitar acoplamento do Prisma ao schema auth.';

create unique index usuario_email_unique_ci
  on usuario (lower(email));

create table condomino (
  id_condomino uuid primary key references usuario(id_usuario) on delete restrict,
  nome_completo varchar(160) not null,
  cpf char(11) not null unique,
  data_nascimento date not null,
  constraint condomino_cpf_formato_chk
    check (cpf ~ '^[0-9]{11}$')
);

create table super_admin (
  id_super_admin uuid primary key references usuario(id_usuario) on delete restrict,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- CONDOMÍNIO E VÍNCULO RESIDENCIAL
-- ------------------------------------------------------------

create table condominio (
  id_condominio uuid primary key default gen_random_uuid(),
  cep varchar(8) not null,
  nome_residencial varchar(160) not null,
  endereco varchar(255) not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  constraint condominio_cep_formato_chk
    check (cep ~ '^[0-9]{8}$')
);

create table vinculo_condominio (
  id_vinculo uuid primary key default gen_random_uuid(),
  id_condomino uuid not null references condomino(id_condomino) on delete restrict,
  id_condominio uuid not null references condominio(id_condominio) on delete restrict,
  moradia varchar(80) not null,
  admin_condominio boolean not null default false,
  status_vinculo status_vinculo_enum not null default 'PENDENTE',
  data_solicitacao timestamptz not null default now(),
  data_aprovacao timestamptz,
  data_inicio timestamptz,
  data_fim timestamptz,
  aprovado_por uuid references usuario(id_usuario) on delete set null,
  admin_atualizado_por uuid references usuario(id_usuario) on delete set null,
  admin_atualizado_em timestamptz
);

create unique index one_active_membership_per_user
  on vinculo_condominio (id_condomino)
  where status_vinculo = 'ATIVO';

create unique index one_pending_membership_per_user
  on vinculo_condominio (id_condomino)
  where status_vinculo = 'PENDENTE';

create index vinculo_condominio_status_idx
  on vinculo_condominio (id_condominio, status_vinculo);

-- ------------------------------------------------------------
-- PRODUTOS
-- ------------------------------------------------------------

create table categoria_produto (
  id_categoria uuid primary key default gen_random_uuid(),
  nome varchar(80) not null unique,
  ativo boolean not null default true
);

create table produto (
  id_produto uuid primary key default gen_random_uuid(),
  id_vinculo_vendedor uuid not null references vinculo_condominio(id_vinculo) on delete restrict,
  id_categoria uuid not null references categoria_produto(id_categoria) on delete restrict,
  nome_produto varchar(140) not null,
  descricao text not null,
  preco numeric(12,2) not null,
  estoque integer not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint produto_preco_chk check (preco > 0),
  constraint produto_estoque_chk check (estoque >= 0),
  constraint produto_nome_chk check (length(trim(nome_produto)) > 0),
  constraint produto_descricao_chk check (length(trim(descricao)) > 0)
);

create index produto_vendedor_ativo_idx
  on produto (id_vinculo_vendedor, ativo);

create index produto_categoria_ativo_idx
  on produto (id_categoria, ativo);

create table produto_imagem (
  id_imagem uuid primary key default gen_random_uuid(),
  id_produto uuid not null references produto(id_produto) on delete cascade,
  storage_path text not null unique,
  ordem smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint produto_imagem_ordem_chk check (ordem >= 0)
);

-- ------------------------------------------------------------
-- PEDIDOS
-- ------------------------------------------------------------

create table pedido (
  id_pedido uuid primary key default gen_random_uuid(),
  id_produto uuid not null references produto(id_produto) on delete restrict,
  id_vinculo_comprador uuid not null references vinculo_condominio(id_vinculo) on delete restrict,
  quantidade integer not null,
  valor_pedido numeric(12,2) not null,
  status_pedido status_pedido_enum not null default 'SOLICITADO',
  hora_solicitacao timestamptz not null default now(),
  hora_combinada timestamptz not null,
  ultima_atualizacao timestamptz not null default now(),
  constraint pedido_quantidade_chk check (quantidade > 0),
  constraint pedido_valor_chk check (valor_pedido > 0),
  constraint pedido_hora_combinada_chk check (hora_combinada >= hora_solicitacao)
);

create index pedido_comprador_status_idx
  on pedido (id_vinculo_comprador, status_pedido);

create index pedido_produto_status_idx
  on pedido (id_produto, status_pedido);

create table pedido_status_historico (
  id_historico uuid primary key default gen_random_uuid(),
  id_pedido uuid not null references pedido(id_pedido) on delete restrict,
  status_anterior status_pedido_enum,
  status_novo status_pedido_enum not null,
  alterado_por uuid not null references usuario(id_usuario) on delete restrict,
  motivo varchar(255),
  created_at timestamptz not null default now()
);

create index historico_pedido_data_idx
  on pedido_status_historico (id_pedido, created_at);

-- ------------------------------------------------------------
-- CHAT
-- ------------------------------------------------------------

create table conversa (
  id_conversa uuid primary key default gen_random_uuid(),
  id_pedido uuid not null unique references pedido(id_pedido) on delete restrict,
  status_conversa status_conversa_enum not null default 'ATIVA',
  created_at timestamptz not null default now(),
  encerrada_em timestamptz
);

create table conversa_participante (
  id_conversa uuid not null references conversa(id_conversa) on delete cascade,
  id_usuario uuid not null references usuario(id_usuario) on delete restrict,
  joined_at timestamptz not null default now(),
  ultimo_lido_em timestamptz,
  primary key (id_conversa, id_usuario)
);

create table mensagem (
  id_mensagem uuid primary key default gen_random_uuid(),
  id_conversa uuid not null references conversa(id_conversa) on delete cascade,
  id_remetente uuid not null references usuario(id_usuario) on delete restrict,
  conteudo text not null,
  created_at timestamptz not null default now(),
  constraint mensagem_conteudo_chk check (length(trim(conteudo)) > 0)
);

create index mensagem_conversa_data_idx
  on mensagem (id_conversa, created_at);

-- ------------------------------------------------------------
-- AUDITORIA
-- ------------------------------------------------------------

create table auditoria (
  id_auditoria uuid primary key default gen_random_uuid(),
  id_ator uuid not null references usuario(id_usuario) on delete restrict,
  acao varchar(100) not null,
  entidade varchar(80) not null,
  entidade_id uuid not null,
  id_condominio uuid references condominio(id_condominio) on delete set null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index auditoria_condominio_data_idx
  on auditoria (id_condominio, created_at);

create index auditoria_ator_data_idx
  on auditoria (id_ator, created_at);

-- ------------------------------------------------------------
-- UPDATED_AT AUTOMÁTICO
-- ------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger usuario_set_updated_at
before update on usuario
for each row
execute function set_updated_at();

create trigger produto_set_updated_at
before update on produto
for each row
execute function set_updated_at();

-- ------------------------------------------------------------
-- RLS: proteção adicional contra acesso direto acidental.
-- O backend usa um usuário PostgreSQL Prisma com BYPASSRLS.
-- Não criamos policies para anon/authenticated porque o projeto
-- usa Express + Prisma como fronteira de acesso ao domínio.
-- ------------------------------------------------------------

alter table usuario enable row level security;
alter table condomino enable row level security;
alter table super_admin enable row level security;
alter table condominio enable row level security;
alter table vinculo_condominio enable row level security;
alter table categoria_produto enable row level security;
alter table produto enable row level security;
alter table produto_imagem enable row level security;
alter table pedido enable row level security;
alter table pedido_status_historico enable row level security;
alter table conversa enable row level security;
alter table conversa_participante enable row level security;
alter table mensagem enable row level security;
alter table auditoria enable row level security;

commit;
