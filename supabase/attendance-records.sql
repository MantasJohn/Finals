-- =============================================================================
-- QR-ATT — attendance records
-- =============================================================================
-- Run once in the Supabase SQL Editor. Safe to run more than once.
--
-- Every attendance row must record at least:
--   * Student            -> attendance.student_id  (FK -> profiles)
--   * Event              -> attendance.event_id    (FK -> events)
--   * Date               -> attendance.scanned_at  (timestamptz, date part)
--   * Time               -> attendance.scanned_at  (timestamptz, time part)
--   * Attendance status  -> attendance.status      (added below)
-- =============================================================================


-- Attendance status -----------------------------------------------------------
-- 'present' is the default; the app marks late check-ins as 'late' and
-- administrators can correct a record to any of the four values.
alter table public.attendance
  add column if not exists status text not null default 'present';

-- Backfill any rows created before the column existed.
update public.attendance set status = 'present' where status is null;

-- Restrict the column to the known statuses.
alter table public.attendance
  drop constraint if exists attendance_status_check;

alter table public.attendance
  add constraint attendance_status_check
  check (status in ('present', 'late', 'excused', 'absent'));


-- Indexes that keep the record list quick -------------------------------------
create index if not exists attendance_student_idx
  on public.attendance (student_id);

create index if not exists attendance_event_idx
  on public.attendance (event_id);

create index if not exists attendance_scanned_at_idx
  on public.attendance (scanned_at desc);
