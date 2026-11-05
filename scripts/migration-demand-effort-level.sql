-- Adds the qualitative effort level while preserving estimated hours and existing actual-effort values.
alter table public.demands add column if not exists effort_level text not null default 'Médio';
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
    select item.value->>'id'
    from jsonb_array_elements(p_records) as item(value)
    group by item.value->>'id'
    having count(*) > 1
  ) then
    raise exception 'Demand IDs must be unique.' using errcode = '22023';
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

  delete from public.demand_staff
  where demand_id in (select id from public.demands);

  insert into public.demands (
    id, name, product_id, owner, status, priority, effort_level, effort, actual_effort,
    billable, billed_amount, progress, due, risk, type, origin, requester,
    version, artifact_number, artifact_url, description, notes, start_date, end_date, due_date, sort_order
  )
  select
    item.value->>'id',
    item.value->>'name',
    product.id,
    coalesce(item.value->>'owner', ''),
    coalesce(item.value->>'status', ''),
    coalesce(item.value->>'priority', ''),
    coalesce(item.value->>'effortLevel', 'Médio'),
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
    item.value->>'artifactUrl',
    item.value->>'description',
    item.value->>'notes',
    item.value->>'startDate',
    item.value->>'endDate',
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
    effort_level = excluded.effort_level,
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
    artifact_url = excluded.artifact_url,
    description = excluded.description,
    notes = excluded.notes,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    due_date = excluded.due_date,
    sort_order = excluded.sort_order;

  insert into public.demand_staff (demand_id, staff_id)
  select item.value->>'id', resource.value::bigint
  from jsonb_array_elements(p_records) as item(value)
  cross join lateral jsonb_array_elements_text(coalesce(item.value->'resourceIds', '[]'::jsonb)) as resource(value)
  on conflict (demand_id, staff_id) do nothing;
end;
$$;

