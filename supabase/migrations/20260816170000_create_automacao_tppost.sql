create table if not exists public.ttpost_installations (
  installation_id text primary key,
  snapshot jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.ttpost_commands (
  id uuid primary key default gen_random_uuid(),
  installation_id text not null references public.ttpost_installations(installation_id) on delete cascade,
  payload jsonb not null,
  status text not null default 'queued'
    check (status in ('queued', 'delivered', 'success', 'failed')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  completed_at timestamptz,
  result jsonb
);

create index if not exists ttpost_commands_pending_idx
  on public.ttpost_commands (installation_id, status, created_at);

alter table public.ttpost_installations enable row level security;
alter table public.ttpost_commands enable row level security;

revoke all on table public.ttpost_installations from anon, authenticated;
revoke all on table public.ttpost_commands from anon, authenticated;

comment on table public.ttpost_installations is
  'Último snapshot enviado por cada instalação do TTpost desktop.';
comment on table public.ttpost_commands is
  'Fila restrita de comandos que a ponte pode devolver ao TTpost.';
