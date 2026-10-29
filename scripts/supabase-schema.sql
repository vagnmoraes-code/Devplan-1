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

-- Refresh this constraint when portal_state was created by an older schema.
alter table public.portal_state drop constraint if exists portal_state_key_check;
alter table public.portal_state add constraint portal_state_key_check check (
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
);

alter table public.portal_state enable row level security;
grant all on table public.portal_state to service_role;

create table if not exists public.portal_accounts (
  id text primary key,
  name text not null,
  email text not null,
  role text not null,
  active boolean default true,
  approved boolean not null default true,
  last_access_at text,
  must_change_password boolean default false,
  product_ids jsonb not null default '[]'::jsonb,
  salt text not null default '',
  password_hash text not null default ''
);

alter table public.portal_accounts add column if not exists name text;
alter table public.portal_accounts add column if not exists email text;
alter table public.portal_accounts add column if not exists role text;
alter table public.portal_accounts add column if not exists active boolean default true;
alter table public.portal_accounts add column if not exists approved boolean not null default true;
alter table public.portal_accounts add column if not exists last_access_at text;
alter table public.portal_accounts add column if not exists must_change_password boolean default false;
alter table public.portal_accounts add column if not exists product_ids jsonb not null default '[]'::jsonb;
alter table public.portal_accounts add column if not exists salt text not null default '';
alter table public.portal_accounts add column if not exists password_hash text not null default '';

alter table public.portal_accounts enable row level security;
grant all on table public.portal_accounts to service_role;

-- Move accounts saved by older portal versions into the dedicated accounts table.
insert into public.portal_accounts (
  id, name, email, role, active, approved, last_access_at,
  must_change_password, product_ids, salt, password_hash
)
select
  mapped.id,
  mapped.name,
  mapped.email,
  mapped.role,
  mapped.active,
  mapped.approved,
  mapped.last_access_at,
  mapped.must_change_password,
  mapped.product_ids,
  mapped.salt,
  mapped.password_hash
from public.portal_state state
cross join lateral jsonb_array_elements(state.value) as account(value)
cross join lateral jsonb_populate_record(
  null::public.portal_accounts,
  jsonb_build_object(
    'id', account.value->>'id',
    'name', account.value->>'name',
    'email', account.value->>'email',
    'role', case account.value->>'role' when 'Editor' then 'Gestor' else account.value->>'role' end,
    'active', account.value->'active',
    'approved', coalesce(account.value->'approved', 'true'::jsonb),
    'last_access_at', account.value->'lastAccessAt',
    'must_change_password', account.value->'mustChangePassword',
    'product_ids', coalesce(account.value->'productIds', '[]'::jsonb),
    'salt', coalesce(account.value->>'salt', ''),
    'password_hash', coalesce(account.value->>'passwordHash', '')
  )
) mapped
where state.key = 'roadmap.accounts.v1'
  and mapped.id is not null
  and mapped.name is not null
  and mapped.email is not null
  and mapped.role is not null
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  role = excluded.role,
  active = excluded.active,
  approved = excluded.approved,
  last_access_at = excluded.last_access_at,
  must_change_password = excluded.must_change_password,
  product_ids = excluded.product_ids,
  salt = excluded.salt,
  password_hash = excluded.password_hash;

delete from public.portal_state where key = 'roadmap.accounts.v1';

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
