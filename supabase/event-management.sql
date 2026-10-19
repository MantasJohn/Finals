-- =============================================================================
-- QR-ATT — event management fields
-- =============================================================================
-- Run once in the Supabase SQL Editor. Safe to run more than once.
--
-- Adds the event fields required by Event Management:
--   venue        text
--   description  text
--   status       'open' | 'closed'   (defaults to 'open')
--
-- name  -> existing `title` column
-- date  -> part of `start_time` / `end_time`
-- time  -> part of `start_time` / `end_time`
-- =============================================================================

alter table public.events add column if not exists venue text;
alter table public.events add column if not exists description text;
alter table public.events
  add column if not exists status text not null default 'open';

-- Keep status to the two supported values.
alter table public.events drop constraint if exists events_status_check;
alter table public.events
  add constraint events_status_check check (status in ('open', 'closed'));

-- Existing rows that predate the column are treated as open.
update public.events set status = 'open' where status is null;
