-- =============================================================================
-- QR-ATT — FIX: "infinite recursion detected in policy for relation attendance"
-- =============================================================================
-- Run once in the Supabase SQL Editor. Safe to run more than once.
--
-- Why this happens
-- ----------------
-- The `attendance` policies contained inline subqueries on `events` and on
-- `profiles`:
--
--     using (... exists (select 1 from public.events e
--                        where e.id = attendance.event_id
--                          and e.created_by = auth.uid()))
--
-- If any policy on those tables refers back to `attendance` (for example a
-- leftover policy from an earlier version), Postgres keeps re-entering the
-- `attendance` policies and aborts with:
--
--     infinite recursion detected in policy for relation "attendance"
--
-- The fix is the standard Supabase pattern: move every cross-table check into a
-- `security definer` helper function. Such a function runs as its owner (which
-- bypasses row level security), so evaluating it never re-enters a policy and
-- the cycle is broken.
-- =============================================================================


-- 1) Helper functions (security definer => RLS inside them is bypassed) -------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_student()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'student'
  );
$$;

-- True when the signed-in user created the given event. This replaces the
-- inline `exists (select 1 from public.events ...)` that used to live inside the
-- attendance policies.
create or replace function public.owns_event(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.events
    where id = p_event_id and created_by = auth.uid()
  );
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_student() to authenticated;
grant execute on function public.owns_event(uuid) to authenticated;


-- 2) Drop every existing policy on events + attendance ------------------------
-- Dropping ALL of them (not just the known names) removes any leftover policy
-- from an earlier version that is part of the recursion cycle.
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('events', 'attendance')
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      pol.policyname, pol.tablename
    );
  end loop;
end $$;

-- Also drop any `profiles` policy that mentions `attendance` — a less common
-- second half of the same cycle — without touching the legitimate ones.
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and (
        coalesce(qual, '') ilike '%attendance%'
        or coalesce(with_check, '') ilike '%attendance%'
      )
  loop
    execute format('drop policy if exists %I on public.profiles', pol.policyname);
  end loop;
end $$;


-- 3) Recreate the policies using the helpers ----------------------------------
alter table public.events     enable row level security;
alter table public.attendance enable row level security;

-- ---- events -----------------------------------------------------------------
-- Everyone may browse events (students need to see what is available).
create policy "events_select"
  on public.events for select
  using (true);

create policy "events_insert"
  on public.events for insert
  with check (auth.uid() = created_by or public.is_admin());

create policy "events_update"
  on public.events for update
  using (auth.uid() = created_by or public.is_admin())
  with check (auth.uid() = created_by or public.is_admin());

create policy "events_delete"
  on public.events for delete
  using (auth.uid() = created_by or public.is_admin());

-- ---- attendance -------------------------------------------------------------
-- Students read/insert their own rows; a teacher reads/deletes rows for the
-- events they created; admins read/correct everything. No policy here refers to
-- `attendance` or `events` through a raw subquery any more.
create policy "attendance_select"
  on public.attendance for select
  using (
    auth.uid() = student_id
    or public.is_admin()
    or public.owns_event(event_id)
  );

create policy "attendance_insert"
  on public.attendance for insert
  with check (
    auth.uid() = student_id
    and public.is_student()
  );

create policy "attendance_update"
  on public.attendance for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "attendance_delete"
  on public.attendance for delete
  using (public.is_admin() or public.owns_event(event_id));


-- =============================================================================
-- If the scan STILL fails afterwards, run this to see the current policies and
-- share the output:
--
--   select tablename, policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename in ('profiles','events','attendance')
--   order by tablename, policyname;
-- =============================================================================
