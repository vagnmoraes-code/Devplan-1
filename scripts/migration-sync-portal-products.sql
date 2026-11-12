-- Keep public.products aligned with the product catalog stored in portal_records.
-- Apply this migration in the Supabase SQL Editor for an existing installation.
begin;

create table if not exists public.portal_product_links (
  portal_product_id bigint primary key,
  product_id integer not null references public.products(id) on delete cascade
);
alter table public.portal_product_links enable row level security;
grant all on table public.portal_product_links to service_role;

create or replace function public.sync_portal_product_record()
returns trigger
language plpgsql
as $$
declare
  portal_id bigint;
  linked_product_id integer;
begin
  if new.collection = 'dev-plan:products' then
    if nullif(new.value->>'id', '') is not null
      and nullif(new.value->>'name', '') is not null then
      portal_id := (new.value->>'id')::bigint;
      select link.product_id into linked_product_id
      from public.portal_product_links link
      where link.portal_product_id = portal_id;

      if linked_product_id is null then
        select product.id into linked_product_id
        from public.products product
        where lower(trim(product.name)) = lower(trim(new.value->>'name'))
        order by product.id
        limit 1;
      end if;

      if linked_product_id is null then
        insert into public.products (name) values (new.value->>'name')
        returning id into linked_product_id;
      else
        update public.products
        set name = new.value->>'name'
        where id = linked_product_id;
      end if;

      insert into public.portal_product_links (portal_product_id, product_id)
      values (portal_id, linked_product_id)
      on conflict (portal_product_id) do update set product_id = excluded.product_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists portal_records_sync_product on public.portal_records;
create trigger portal_records_sync_product
after insert or update of value, collection on public.portal_records
for each row execute function public.sync_portal_product_record();

update public.portal_records
set value = value
where collection = 'dev-plan:products';

revoke all on function public.sync_portal_product_record() from public, anon, authenticated;
grant execute on function public.sync_portal_product_record() to service_role;

commit;
