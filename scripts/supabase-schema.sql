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

-- Store each business record on its own row instead of keeping a whole collection in one JSON value.
create table if not exists public.portal_records (
  collection text not null check (
    collection in (
      'dev-plan:products',
      'dev-plan:demands',
      'dev-plan:roadmap',
      'dev-plan:history',
      'dev-plan:roadmap-versions',
      'dev-plan:team',
      'dev-plan:initiatives'
    )
  ),
  record_id text not null,
  position integer not null default 0,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, record_id)
);

alter table public.portal_records enable row level security;
grant all on table public.portal_records to service_role;

create or replace function public.portal_record_id(p_collection text, p_value jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(p_value->>'id', ''),
    case when p_collection = 'dev-plan:roadmap'
      and p_value->>'demandId' is not null
      and p_value->>'quarter' is not null
      then (p_value->>'demandId') || ':' || (p_value->>'quarter')
      else null
    end,
    md5(p_value::text)
  );
$$;

revoke all on function public.portal_record_id(text, jsonb) from public, anon, authenticated;
grant execute on function public.portal_record_id(text, jsonb) to service_role;

create or replace function public.replace_portal_records(p_collection text, p_records jsonb)
returns void
language plpgsql
as $$
begin
  if p_collection not in (
    'dev-plan:products', 'dev-plan:demands', 'dev-plan:roadmap',
    'dev-plan:history', 'dev-plan:roadmap-versions', 'dev-plan:team',
    'dev-plan:initiatives'
  ) then
    raise exception 'Invalid portal collection.';
  end if;

  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'Portal records must be a JSON array.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or public.portal_record_id(p_collection, item.value) is null
  ) then
    raise exception 'Each portal record must be a JSON object with an identifier.';
  end if;

  delete from public.portal_records existing
  where existing.collection = p_collection
    and not exists (
      select 1
      from jsonb_array_elements(p_records) as item(value)
      where public.portal_record_id(p_collection, item.value) = existing.record_id
    );

  insert into public.portal_records (collection, record_id, position, value, updated_at)
  select
    p_collection,
    public.portal_record_id(p_collection, item.value),
    (item.ordinality - 1)::integer,
    item.value,
    now()
  from jsonb_array_elements(p_records) with ordinality as item(value, ordinality)
  on conflict (collection, record_id) do update set
    position = excluded.position,
    value = excluded.value,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.replace_portal_records(text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_portal_records(text, jsonb) to service_role;

-- Move existing collections without changing their array order, then empty the legacy table.
insert into public.portal_records (collection, record_id, position, value)
select
  state.key,
  public.portal_record_id(state.key, item.value),
  (item.ordinality - 1)::integer,
  item.value
from public.portal_state state
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(state.value) = 'array' then state.value else '[]'::jsonb end
) with ordinality as item(value, ordinality)
where state.key in (
  'dev-plan:products', 'dev-plan:demands', 'dev-plan:roadmap',
  'dev-plan:history', 'dev-plan:roadmap-versions', 'dev-plan:team',
  'dev-plan:initiatives'
)
  and jsonb_typeof(state.value) = 'array'
on conflict (collection, record_id) do nothing;

delete from public.portal_state where key in (
  'dev-plan:products', 'dev-plan:demands', 'dev-plan:roadmap',
  'dev-plan:history', 'dev-plan:roadmap-versions', 'dev-plan:team',
  'dev-plan:initiatives'
);

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
