-- Consolida a casa individual de Luan na casa compartilhada com Maisa.
-- Mantém uma cópia recuperável antes da exclusão e endurece a privacidade
-- dos registros genéricos sincronizados pelo aplicativo Android.

create schema if not exists private;

create table if not exists private.household_merge_backups (
  id uuid primary key default gen_random_uuid(),
  source_household_id uuid not null,
  target_household_id uuid not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
revoke all on table private.household_merge_backups from public, anon, authenticated;

do $$
declare
  source_id constant uuid := 'e42418d1-61fb-47c5-88cd-3e4b6322ee0e';
  target_id constant uuid := '04b06d11-34d4-4ab0-9d21-a935560793af';
begin
  if exists (select 1 from public.households where id = source_id) then
    insert into private.household_merge_backups (
      source_household_id,
      target_household_id,
      snapshot
    )
    select
      source_id,
      target_id,
      jsonb_build_object(
        'household', (select to_jsonb(h) from public.households h where h.id = source_id),
        'members', coalesce((select jsonb_agg(to_jsonb(m)) from public.household_members m where m.household_id = source_id), '[]'::jsonb),
        'invites', coalesce((select jsonb_agg(to_jsonb(i)) from public.household_invites i where i.household_id = source_id), '[]'::jsonb),
        'categories', coalesce((select jsonb_agg(to_jsonb(c)) from public.categories c where c.household_id = source_id), '[]'::jsonb),
        'sync_records', coalesce((select jsonb_agg(to_jsonb(r)) from public.juntos_sync_records r where r.household_id = source_id), '[]'::jsonb)
      );

    insert into public.juntos_sync_records (
      household_id,
      record_id,
      table_name,
      payload,
      deleted,
      updated_by,
      updated_at
    )
    select
      target_id,
      r.record_id,
      r.table_name,
      r.payload,
      r.deleted,
      r.updated_by,
      r.updated_at
    from public.juntos_sync_records r
    where r.household_id = source_id
    on conflict (household_id, table_name, record_id) do update
    set payload = excluded.payload,
        deleted = excluded.deleted,
        updated_by = excluded.updated_by
    where excluded.updated_at > public.juntos_sync_records.updated_at;

    delete from public.households where id = source_id;
  end if;

  update public.households
  set name = 'Luan e Maisa'
  where id = target_id;
end;
$$;

drop policy if exists juntos_sync_records_select on public.juntos_sync_records;
drop policy if exists juntos_sync_records_insert on public.juntos_sync_records;
drop policy if exists juntos_sync_records_update on public.juntos_sync_records;
drop policy if exists juntos_sync_records_delete on public.juntos_sync_records;

create policy juntos_sync_records_select
on public.juntos_sync_records
for select to authenticated
using (
  public.is_household_member(household_id)
  and (
    table_name = 'categories'
    or payload ->> 'scope' = 'shared'
    or payload ->> 'owner_uid' = (select auth.uid())::text
  )
);

create policy juntos_sync_records_insert
on public.juntos_sync_records
for insert to authenticated
with check (
  public.is_household_member(household_id)
  and updated_by = (select auth.uid())
  and (
    table_name = 'categories'
    or (
      payload ->> 'owner_uid' = (select auth.uid())::text
      and payload ->> 'scope' in ('personal', 'shared')
    )
  )
);

create policy juntos_sync_records_update
on public.juntos_sync_records
for update to authenticated
using (
  public.is_household_member(household_id)
  and (
    table_name = 'categories'
    or payload ->> 'scope' = 'shared'
    or payload ->> 'owner_uid' = (select auth.uid())::text
  )
)
with check (
  public.is_household_member(household_id)
  and updated_by = (select auth.uid())
  and (
    deleted
    or table_name = 'categories'
    or payload ->> 'scope' = 'shared'
    or (
      payload ->> 'scope' = 'personal'
      and payload ->> 'owner_uid' = (select auth.uid())::text
    )
  )
);

create policy juntos_sync_records_delete
on public.juntos_sync_records
for delete to authenticated
using (
  public.is_household_member(household_id)
  and (
    table_name = 'categories'
    or payload ->> 'scope' = 'shared'
    or payload ->> 'owner_uid' = (select auth.uid())::text
  )
);

create or replace function public.protect_juntos_sync_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.household_id is distinct from old.household_id
     or new.table_name is distinct from old.table_name
     or new.record_id is distinct from old.record_id then
    raise exception 'Sync record identity cannot be changed';
  end if;

  if not new.deleted
     and old.table_name <> 'categories'
     and coalesce(old.payload ->> 'owner_uid', '') <> ''
     and new.payload ->> 'owner_uid' is distinct from old.payload ->> 'owner_uid' then
    raise exception 'Sync record owner cannot be changed';
  end if;

  return new;
end;
$$;

drop trigger if exists juntos_sync_records_protect_identity on public.juntos_sync_records;
create trigger juntos_sync_records_protect_identity
before update on public.juntos_sync_records
for each row execute function public.protect_juntos_sync_identity();

revoke all on function public.protect_juntos_sync_identity() from public, anon, authenticated;

