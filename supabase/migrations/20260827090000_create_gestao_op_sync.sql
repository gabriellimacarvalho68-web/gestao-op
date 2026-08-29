-- Espaços privados de sincronização do Gestão OP.
-- A chave de pareamento nunca é armazenada em texto puro: somente SHA-256.
create table if not exists public.gestao_op_sync_spaces (
  id uuid primary key default gen_random_uuid(),
  access_key_hash text not null,
  snapshot jsonb,
  modified_at timestamptz,
  updated_at timestamptz not null default now(),
  last_source_id text,
  created_at timestamptz not null default now()
);

alter table public.gestao_op_sync_spaces enable row level security;
revoke all on table public.gestao_op_sync_spaces from anon, authenticated;

comment on table public.gestao_op_sync_spaces is
  'Backup mais recente de cada espaço privado de sincronização do Gestão OP.';
