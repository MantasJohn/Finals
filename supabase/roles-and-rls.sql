-- =============================================================================
-- QR-ATT — roles & row level security
-- =============================================================================
-- Run this in the Supabase SQL Editor. It is safe to run more than once.
--
-- The app now supports three roles: 'student', 'teacher' and 'admin'.
-- Everything below assumes the schema already used by the app:
--   profiles   (id uuid PK -> auth.users, email text, full_name text, role ...)
--   events     (id uuid PK, event_code text, title text, start_time, end_time,
--               created_by uuid, created_at)
--   attendance (id uuid PK, student_id uuid, event_id uuid, scanned_at)
--
-- If `profiles.role` is a Postgres ENUM, add the new value first (uncomment):
--   ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin';
-- =============================================================================


-- 1) Tell Postgres how to recognize an administrator -------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- 1b) Role / ownership helpers -----------------------------------------------
-- Cross-table checks inside RLS policies must live in `security definer`
-- functions. A raw subquery inside a policy re-enters the other table's
-- policies, which recurses (and Postgres aborts with "infinite recursion
-- detected in policy") as soon as the other table points back at this one.
create or replace function public.is_student()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'student'
  );
$$;

grant execute on function public.is_student() to authenticated;

create or replace function public.owns_event(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.events
    where id = p_event_id
      and created_by = auth.uid()
  );
$$;

grant execute on function public.owns_event(uuid) to authenticated;


-- 2) Row level security ------------------------------------------------------
alter table public.profiles   enable row level security;
alter table public.events     enable row level security;
alter table public.attendance enable row level security;


-- ---- profiles ---------------------------------------------------------------
-- Everyone can read their own profile...
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

-- ...and update their own name/role.
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());


-- ---- events -----------------------------------------------------------------
-- Students need to browse events; teachers need their own; admins need all.
drop policy if exists "events_select" on public.events;
create policy "events_select"
  on public.events for select
  using (true);

drop policy if exists "events_insert" on public.events;
create policy "events_insert"
  on public.events for insert
  with check (
    auth.uid() = created_by
    or public.is_admin()
  );

drop policy if exists "events_update" on public.events;
create policy "events_update"
  on public.events for update
  using (auth.uid() = created_by or public.is_admin())
  with check (auth.uid() = created_by or public.is_admin());

drop policy if exists "events_delete" on public.events;
create policy "events_delete"
  on public.events for delete
  using (auth.uid() = created_by or public.is_admin());


-- ---- attendance -------------------------------------------------------------
-- Students insert/read their own rows; teachers read rows for their events;
-- admins read and correct everything.
drop policy if exists "attendance_select" on public.attendance;
create policy "attendance_select"
  on public.attendance for select
  using (
    auth.uid() = student_id
    or public.is_admin()
    or public.owns_event(event_id)
  );

drop policy if exists "attendance_insert" on public.attendance;
create policy "attendance_insert"
  on public.attendance for insert
  with check (
    -- students may only ever insert their own row...
    auth.uid() = student_id
    -- ...and only accounts whose profile role is 'student'.
    and public.is_student()
  );

drop policy if exists "attendance_update" on public.attendance;
create policy "attendance_update"
  on public.attendance for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "attendance_delete" on public.attendance;
create policy "attendance_delete"
  on public.attendance for delete
  using (
    public.is_admin()
    or public.owns_event(event_id)
  );


-- 3) Create the first administrator ------------------------------------------
-- Promote an existing account (sign the account up in the app first):
--   update public.profiles set role = 'admin' where email = 'admin@school.edu';
--
-- Or instruct the account holder to run this once from the SQL editor.
-- -----------------------------------------------------------------------------
