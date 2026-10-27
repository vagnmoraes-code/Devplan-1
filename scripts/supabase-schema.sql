create table if not exists public.portal_state (
  key text primary key check (
    key in (
      'dev-plan:products',
      'dev-plan:demands',
      'dev-plan:roadmap',
      'dev-plan:history',
      'dev-plan:roadmap-versions',
      'dev-plan:team',
      'dev-plan:initiatives',
      'roadmap.accounts.v1'
    )
  ),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.portal_state enable row level security;
grant all on table public.portal_state to service_role;

create or replace function public.set_portal_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists portal_state_updated_at on public.portal_state;
create trigger portal_state_updated_at
before update on public.portal_state
for each row execute function public.set_portal_state_updated_at();
