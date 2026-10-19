-- =============================================================================
-- QR-ATT — complete Supabase setup
-- =============================================================================
-- Project: https://qwcvksggddcmgqwyjvfg.supabase.co
--
-- HOW TO RUN
--   1. Open the Supabase dashboard for the project above.
--   2. Go to SQL Editor -> New query.
--   3. Paste this entire file and click Run.
--
-- The script is idempotent: it is safe to run more than once. It combines the
-- five files in supabase/ in the order the app expects, and additionally
-- guarantees the base tables and the profile-creation trigger exist.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) Base tables (created only when missing) -----------------------------------
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'student',
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  event_code  text not null unique,
  title       text not null,
  start_time  timestamptz,
  end_time    timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  venue       text,
  description text,
  status      text not null default 'open'
);

create table if not exists public.attendance (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  scanned_at timestamptz not null default now()
);

-- Fill in columns that an older version of the tables might be missing.
alter table public.profiles   add column if not exists email      text;
alter table public.profiles   add column if not exists full_name  text;
alter table public.profiles   add column if not exists created_at timestamptz not null default now();
alter table public.events     add column if not exists venue      text;
alter table public.events     add column if not exists description text;
alter table public.events     add column if not exists status     text not null default 'open';
alter table public.attendance add column if not exists scanned_at timestamptz not null default now();

-- Older setups only allowed 'student' and 'teacher' here. Replace the check so
-- administrators can be promoted (the app supports all three roles).
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('student', 'teacher', 'admin'));

-- Access grants. Row Level Security still decides which rows are visible.
grant usage on schema public to anon, authenticated;
grant select on public.events to anon;
grant select, insert, update, delete
  on public.profiles, public.events, public.attendance
  to authenticated;


-- -----------------------------------------------------------------------------
-- 2) Create a profile automatically when someone signs up ----------------------
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'student')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();


-- -----------------------------------------------------------------------------
-- 3) Event management fields (supabase/event-management.sql) -------------------
-- -----------------------------------------------------------------------------
alter table public.events add column if not exists venue text;
alter table public.events add column if not exists description text;
alter table public.events
  add column if not exists status text not null default 'open';

alter table public.events drop constraint if exists events_status_check;
alter table public.events
  add constraint events_status_check check (status in ('open', 'closed'));

update public.events set status = 'open' where status is null;


-- -----------------------------------------------------------------------------
-- 4) Attendance records (supabase/attendance-records.sql) ----------------------
-- -----------------------------------------------------------------------------
alter table public.attendance
  add column if not exists status text not null default 'present';

update public.attendance set status = 'present' where status is null;

alter table public.attendance
  drop constraint if exists attendance_status_check;

alter table public.attendance
  add constraint attendance_status_check
  check (status in ('present', 'late', 'excused', 'absent'));

create index if not exists attendance_student_idx
  on public.attendance (student_id);

create index if not exists attendance_event_idx
  on public.attendance (event_id);

create index if not exists attendance_scanned_at_idx
  on public.attendance (scanned_at desc);


-- -----------------------------------------------------------------------------
-- 5) Roles & Row Level Security (supabase/roles-and-rls.sql) -------------------
-- -----------------------------------------------------------------------------
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

alter table public.profiles   enable row level security;
alter table public.events     enable row level security;
alter table public.attendance enable row level security;


-- ---- profiles ---------------------------------------------------------------
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());


-- ---- events -----------------------------------------------------------------
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
    auth.uid() = student_id
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


-- -----------------------------------------------------------------------------
-- 6) Recreate event/attendance policies cleanly (supabase/fix-attendance-rls.sql)
--    Removes any leftover policy that could cause
--    "infinite recursion detected in policy for relation attendance".
-- -----------------------------------------------------------------------------
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

alter table public.events     enable row level security;
alter table public.attendance enable row level security;

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


-- -----------------------------------------------------------------------------
-- 7) Attendance validation (supabase/attendance-validation.sql) ----------------
-- -----------------------------------------------------------------------------
create unique index if not exists attendance_student_event_uidx
  on public.attendance (student_id, event_id);

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

-- The attendance_insert policy already restricts inserts to signed-in students
-- writing their own row; is_student() was (re)created in section 5.


-- =============================================================================
-- DONE. Optional next step — promote an administrator (sign them up first):
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
-- =============================================================================
