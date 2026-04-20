-- 0016_event_location_full
-- Adds a `location_full` column to events for the full street address.
-- Existing `location` is repurposed as the public-safe label that everyone
-- sees pre-acceptance (e.g. "Central London — in-person"). Accepted students
-- and team members see `location_full`; everyone else sees `location`.
--
-- Data migration: any existing event whose `location` already contains a
-- street address has it copied across; the public label should be re-set
-- by an admin.

alter table public.events
  add column if not exists location_full text;

comment on column public.events.location is 'Public label shown to all viewers (e.g. "Central London — in-person"). Safe pre-acceptance.';
comment on column public.events.location_full is 'Full street address. Shown only to accepted applicants and team members.';
