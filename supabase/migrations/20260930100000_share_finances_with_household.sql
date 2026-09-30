-- Finanças ficam visíveis para os dois membros da casa.
-- Tarefas e compromissos pessoais continuam privados.

drop policy if exists juntos_sync_records_select on public.juntos_sync_records;

create policy juntos_sync_records_select
on public.juntos_sync_records
for select to authenticated
using (
  public.is_household_member(household_id)
  and (
    table_name = 'categories'
    or table_name in (
      'accounts',
      'cards',
      'transactions',
      'budgets',
      'goals',
      'recurring_expenses'
    )
    or payload ->> 'scope' = 'shared'
    or payload ->> 'owner_uid' = (select auth.uid())::text
  )
);

