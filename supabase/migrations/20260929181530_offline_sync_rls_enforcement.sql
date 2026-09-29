-- Execute offline changes with the caller's permissions so every write
-- continues to pass through the table RLS policies.
alter function public.apply_offline_change(
  text,
  uuid,
  uuid,
  bigint,
  jsonb,
  public.sync_operation
) security invoker;
