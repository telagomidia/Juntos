-- Juntos Web: agenda, escopo pessoal/compartilhado e endurecimento de acesso.
-- Compatível com a estrutura Android existente.

alter table public.tasks add column if not exists scope public.scope_type not null default 'shared';
alter table public.goals add column if not exists scope public.scope_type not null default 'shared';
alter table public.recurring_items add column if not exists scope public.scope_type not null default 'shared';
alter table public.budgets add column if not exists created_by uuid references auth.users(id) default auth.uid();
alter table public.budgets add column if not exists scope public.scope_type not null default 'shared';

update public.budgets set created_by = coalesce(created_by, (select created_by from public.households h where h.id = budgets.household_id)) where created_by is null;
alter table public.budgets alter column created_by set not null;

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  responsible_user_id uuid references auth.users(id),
  scope public.scope_type not null default 'shared',
  title text not null check (char_length(title) between 1 and 100),
  description text check (description is null or char_length(description) <= 500),
  location text check (location is null or char_length(location) <= 120),
  starts_at timestamptz not null,
  ends_at timestamptz,
  reminder_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','done','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sync_version bigint not null default 1,
  constraint calendar_events_time_order check (ends_at is null or ends_at >= starts_at)
);

create index if not exists idx_calendar_events_household_start on public.calendar_events(household_id, starts_at);
create index if not exists idx_calendar_events_created_by on public.calendar_events(created_by);
create index if not exists idx_household_members_user on public.household_members(user_id);
create index if not exists idx_accounts_household on public.accounts(household_id);
create index if not exists idx_accounts_owner on public.accounts(owner_user_id);
create index if not exists idx_cards_household on public.credit_cards(household_id);
create index if not exists idx_cards_owner on public.credit_cards(owner_user_id);
create index if not exists idx_transactions_account on public.transactions(account_id);
create index if not exists idx_transactions_card on public.transactions(credit_card_id);
create index if not exists idx_tasks_assigned on public.tasks(assigned_to);

alter table public.calendar_events enable row level security;

drop policy if exists calendar_events_access on public.calendar_events;
drop policy if exists calendar_events_select on public.calendar_events;
drop policy if exists calendar_events_insert on public.calendar_events;
drop policy if exists calendar_events_update on public.calendar_events;
drop policy if exists calendar_events_delete on public.calendar_events;
create policy calendar_events_select on public.calendar_events for select to authenticated
using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));
create policy calendar_events_insert on public.calendar_events for insert to authenticated
with check (public.is_household_member(household_id) and created_by = (select auth.uid()));
create policy calendar_events_update on public.calendar_events for update to authenticated
using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())))
with check (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));
create policy calendar_events_delete on public.calendar_events for delete to authenticated
using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));

drop policy if exists tasks_all on public.tasks;
drop policy if exists tasks_access on public.tasks;
drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists tasks_delete on public.tasks;
create policy tasks_select on public.tasks for select to authenticated using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));
create policy tasks_insert on public.tasks for insert to authenticated with check (public.is_household_member(household_id) and created_by = (select auth.uid()));
create policy tasks_update on public.tasks for update to authenticated using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid()))) with check (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));
create policy tasks_delete on public.tasks for delete to authenticated using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));

drop policy if exists goals_all on public.goals;
drop policy if exists goals_access on public.goals;
drop policy if exists goals_select on public.goals;
drop policy if exists goals_insert on public.goals;
drop policy if exists goals_update on public.goals;
drop policy if exists goals_delete on public.goals;
create policy goals_select on public.goals for select to authenticated using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));
create policy goals_insert on public.goals for insert to authenticated with check (public.is_household_member(household_id) and created_by = (select auth.uid()));
create policy goals_update on public.goals for update to authenticated using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid()))) with check (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));
create policy goals_delete on public.goals for delete to authenticated using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));

drop policy if exists recurring_all on public.recurring_items;
drop policy if exists recurring_access on public.recurring_items;
drop policy if exists recurring_select on public.recurring_items;
drop policy if exists recurring_insert on public.recurring_items;
drop policy if exists recurring_update on public.recurring_items;
drop policy if exists recurring_delete on public.recurring_items;
create policy recurring_select on public.recurring_items for select to authenticated using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));
create policy recurring_insert on public.recurring_items for insert to authenticated with check (public.is_household_member(household_id) and created_by = (select auth.uid()));
create policy recurring_update on public.recurring_items for update to authenticated using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid()))) with check (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));
create policy recurring_delete on public.recurring_items for delete to authenticated using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));

drop policy if exists budgets_all on public.budgets;
drop policy if exists budgets_access on public.budgets;
drop policy if exists budgets_select on public.budgets;
drop policy if exists budgets_insert on public.budgets;
drop policy if exists budgets_update on public.budgets;
drop policy if exists budgets_delete on public.budgets;
create policy budgets_select on public.budgets for select to authenticated using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));
create policy budgets_insert on public.budgets for insert to authenticated with check (public.is_household_member(household_id) and created_by = (select auth.uid()));
create policy budgets_update on public.budgets for update to authenticated using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid()))) with check (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));
create policy budgets_delete on public.budgets for delete to authenticated using (public.is_household_member(household_id) and (scope = 'shared' or created_by = (select auth.uid())));

drop policy if exists conflicts_household_insert on public.sync_conflicts;
drop policy if exists conflicts_household_select on public.sync_conflicts;
drop policy if exists conflicts_household_update on public.sync_conflicts;
create policy conflicts_household_insert on public.sync_conflicts for insert to authenticated
with check (public.is_household_member(household_id) and created_by = (select auth.uid()));
create policy conflicts_household_select on public.sync_conflicts for select to authenticated
using (public.is_household_member(household_id));
create policy conflicts_household_update on public.sync_conflicts for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

create or replace function public.validate_calendar_event_membership()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.responsible_user_id is not null and not exists (
    select 1 from public.household_members hm
    where hm.household_id = new.household_id and hm.user_id = new.responsible_user_id
  ) then
    raise exception 'Responsible user must belong to household';
  end if;
  return new;
end;
$$;

create or replace function public.protect_juntos_record_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.household_id is distinct from old.household_id or new.created_by is distinct from old.created_by then
    raise exception 'Record ownership cannot be changed';
  end if;
  if new.scope is distinct from old.scope and old.created_by <> auth.uid() then
    raise exception 'Only the creator can change visibility';
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_events_updated_at on public.calendar_events;
create trigger calendar_events_updated_at before update on public.calendar_events
for each row execute function public.set_updated_at();
drop trigger if exists calendar_events_sync_version on public.calendar_events;
create trigger calendar_events_sync_version before update on public.calendar_events
for each row execute function public.bump_sync_version();
drop trigger if exists calendar_events_membership on public.calendar_events;
create trigger calendar_events_membership before insert or update on public.calendar_events
for each row execute function public.validate_calendar_event_membership();

drop trigger if exists tasks_protect_identity on public.tasks;
create trigger tasks_protect_identity before update on public.tasks for each row execute function public.protect_juntos_record_identity();
drop trigger if exists goals_protect_identity on public.goals;
create trigger goals_protect_identity before update on public.goals for each row execute function public.protect_juntos_record_identity();
drop trigger if exists budgets_protect_identity on public.budgets;
create trigger budgets_protect_identity before update on public.budgets for each row execute function public.protect_juntos_record_identity();
drop trigger if exists recurring_protect_identity on public.recurring_items;
create trigger recurring_protect_identity before update on public.recurring_items for each row execute function public.protect_juntos_record_identity();
drop trigger if exists calendar_events_protect_identity on public.calendar_events;
create trigger calendar_events_protect_identity before update on public.calendar_events for each row execute function public.protect_juntos_record_identity();

grant select, insert, update, delete on public.calendar_events to authenticated;
grant select, insert, update, delete on public.accounts, public.credit_cards, public.transactions,
  public.tasks, public.goals, public.budgets, public.recurring_items, public.categories to authenticated;

revoke all on function public.accept_household_invite(uuid) from public;
revoke all on function public.create_household(text) from public;
revoke all on function public.create_household_invite(uuid,text) from public;
revoke all on function public.apply_offline_change(text,uuid,uuid,bigint,jsonb,public.sync_operation) from public;
revoke all on function public.complete_task(uuid) from public;
revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.validate_calendar_event_membership() from public;
revoke all on function public.protect_juntos_record_identity() from public;

grant execute on function public.accept_household_invite(uuid) to authenticated;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.create_household_invite(uuid,text) to authenticated;
grant execute on function public.apply_offline_change(text,uuid,uuid,bigint,jsonb,public.sync_operation) to authenticated;
grant execute on function public.complete_task(uuid) to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.bump_sync_version() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.touch_juntos_sync_record() from public, anon, authenticated;
revoke all on function public.validate_juntos_household_references() from public, anon, authenticated;
revoke all on function public.validate_juntos_row_membership() from public, anon, authenticated;
revoke all on function public.validate_calendar_event_membership() from public, anon, authenticated;
revoke all on function public.protect_juntos_record_identity() from public, anon, authenticated;
