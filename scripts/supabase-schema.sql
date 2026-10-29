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

-- Demand rows use the existing functional table and reference products by id.
create table if not exists public.demands (
  id text primary key,
  name text not null,
  product_id integer references public.products(id) on delete set null,
  owner text not null default '',
  status text not null default '',
  priority text not null default '',
  effort numeric not null default 0,
  actual_effort numeric,
  billable boolean,
  billed_amount numeric,
  progress numeric not null default 0,
  due text not null default '',
  risk text not null default '',
  type text,
  origin text,
  requester text,
  version text,
  artifact_number text,
  notes text,
  start_date text,
  due_date text
);

alter table public.demands add column if not exists sort_order integer not null default 0;
alter table public.demands enable row level security;
grant all on table public.demands to service_role;
alter table public.demand_staff enable row level security;
grant all on table public.demand_staff to service_role;

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
    'dev-plan:products', 'dev-plan:roadmap',
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

create or replace function public.replace_portal_demands(p_records jsonb)
returns void
language plpgsql
as $$
begin
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'Demands must be a JSON array.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_records) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or nullif(item.value->>'id', '') is null
      or nullif(item.value->>'name', '') is null
  ) then
    raise exception 'Each demand must have an id and name.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as item(value)
    where nullif(item.value->>'product', '') is not null
      and not exists (
        select 1 from public.products product
        where lower(trim(product.name)) = lower(trim(item.value->>'product'))
      )
  ) then
    raise exception 'A demand references a product that does not exist in public.products.';
  end if;

  delete from public.demand_staff link
  where not exists (
    select 1 from jsonb_array_elements(p_records) as item(value)
    where item.value->>'id' = link.demand_id
  );

  delete from public.roadmap_allocations allocation
  using public.roadmap_entries entry
  where allocation.roadmap_entry_id = entry.id
    and not exists (
      select 1 from jsonb_array_elements(p_records) as item(value)
      where item.value->>'id' = entry.demand_id
    );

  delete from public.roadmap_collaborators collaborator
  using public.roadmap_entries entry
  where collaborator.roadmap_entry_id = entry.id
    and not exists (
      select 1 from jsonb_array_elements(p_records) as item(value)
      where item.value->>'id' = entry.demand_id
    );

  delete from public.roadmap_entries entry
  where not exists (
    select 1 from jsonb_array_elements(p_records) as item(value)
    where item.value->>'id' = entry.demand_id
  );

  delete from public.demands demand
  where not exists (
    select 1 from jsonb_array_elements(p_records) as item(value)
    where item.value->>'id' = demand.id
  );

  delete from public.demand_staff;

  insert into public.demands (
    id, name, product_id, owner, status, priority, effort, actual_effort,
    billable, billed_amount, progress, due, risk, type, origin, requester,
    version, artifact_number, notes, start_date, due_date, sort_order
  )
  select
    item.value->>'id',
    item.value->>'name',
    product.id,
    coalesce(item.value->>'owner', ''),
    coalesce(item.value->>'status', ''),
    coalesce(item.value->>'priority', ''),
    coalesce(nullif(item.value->>'effort', '')::numeric, 0),
    nullif(item.value->>'actualEffort', '')::numeric,
    nullif(item.value->>'billable', '')::boolean,
    nullif(item.value->>'billedAmount', '')::numeric,
    coalesce(nullif(item.value->>'progress', '')::numeric, 0),
    coalesce(item.value->>'due', ''),
    coalesce(item.value->>'risk', ''),
    item.value->>'type',
    item.value->>'origin',
    item.value->>'requester',
    item.value->>'version',
    item.value->>'artifactNumber',
    item.value->>'notes',
    item.value->>'startDate',
    item.value->>'dueDate',
    (item.ordinality - 1)::integer
  from jsonb_array_elements(p_records) with ordinality as item(value, ordinality)
  left join lateral (
    select existing.id
    from public.products existing
    where lower(trim(existing.name)) = lower(trim(item.value->>'product'))
    order by existing.id
    limit 1
  ) product on true
  on conflict (id) do update set
    name = excluded.name,
    product_id = excluded.product_id,
    owner = excluded.owner,
    status = excluded.status,
    priority = excluded.priority,
    effort = excluded.effort,
    actual_effort = excluded.actual_effort,
    billable = excluded.billable,
    billed_amount = excluded.billed_amount,
    progress = excluded.progress,
    due = excluded.due,
    risk = excluded.risk,
    type = excluded.type,
    origin = excluded.origin,
    requester = excluded.requester,
    version = excluded.version,
    artifact_number = excluded.artifact_number,
    notes = excluded.notes,
    start_date = excluded.start_date,
    due_date = excluded.due_date,
    sort_order = excluded.sort_order;

  insert into public.demand_staff (demand_id, staff_id)
  select item.value->>'id', resource.value::bigint
  from jsonb_array_elements(p_records) as item(value)
  cross join lateral jsonb_array_elements_text(coalesce(item.value->'resourceIds', '[]'::jsonb)) as resource(value)
  on conflict (demand_id, staff_id) do nothing;
end;
$$;

revoke all on function public.replace_portal_demands(jsonb) from public, anon, authenticated;
grant execute on function public.replace_portal_demands(jsonb) to service_role;

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

-- Move existing demand records to public.demands; keep the source rows if validation fails.
do $$
declare
  existing_demands jsonb;
begin
  select coalesce(jsonb_agg(value order by position), '[]'::jsonb)
  into existing_demands
  from public.portal_records
  where collection = 'dev-plan:demands';

  if jsonb_array_length(existing_demands) > 0 then
    perform public.replace_portal_demands(existing_demands);
    delete from public.portal_records where collection = 'dev-plan:demands';
  end if;
end;
$$;

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
