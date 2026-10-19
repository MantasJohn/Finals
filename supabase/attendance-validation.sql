-- =============================================================================
-- QR-ATT — attendance validation (database-level safeguards)
-- =============================================================================
-- Run once in the Supabase SQL Editor. Safe to run more than once.
--
-- The app already validates QR codes, event status, the time window, duplicates
-- and authorization in `lib/attendance.ts`. These rules add a second layer at
-- the database so the rules hold even if the API is called directly.
-- =============================================================================


-- 1) Duplicate attendance -----------------------------------------------------
-- A student can check in at most once per event. The unique index makes the
-- duplicate insert fail with SQLSTATE 23505, which the app maps to
-- "Already registered for this event."
create unique index if not exists attendance_student_event_uidx
  on public.attendance (student_id, event_id);


-- 2) Attendance for closed events ---------------------------------------------
-- Block inserting a row when its event's status is 'closed'.
create or replace function public.prevent_closed_event_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_status text;
begin
  select status into event_status from public.events where id = new.event_id;

  if event_status = 'closed' then
    raise exception 'This event is closed; attendance cannot be recorded.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_closed_event_attendance on public.attendance;
create trigger trg_prevent_closed_event_attendance
  before insert on public.attendance
  for each row
  execute function public.prevent_closed_event_attendance();


-- 3) Unauthorized attendance recording ----------------------------------------
-- See `roles-and-rls.sql`: the `attendance_insert` policy only allows a signed-in
-- user whose profile role is 'student' to insert a row for their own account.
-- Re-assert it here so this file is self-contained.
drop policy if exists "attendance_insert" on public.attendance;
create policy "attendance_insert"
  on public.attendance for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'student'
    )
  );
