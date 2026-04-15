-- =============================================================================
-- Steps Intranet — drop applications.consent_given
-- Date: 2026-04-15
--
-- Rationale
-- ---------
-- `applications.consent_given` was defined in 0001 as a NOT NULL bool recording
-- "did the applicant consent at time of application". In practice this is
-- tautological: an applicant submitting a form with their contact details is,
-- by the act of submission, giving us the data for the purpose of processing
-- that application. The column would always be TRUE and carries no audit
-- value.
--
-- What actually matters is:
--   - `students.subscribed_to_mailing` — mutable marketing-subscription state,
--     flips to false on unsubscribe. Kept.
--   - `applications.consent_text_version` — the version of the privacy-notice
--     wording shown at intake. Useful for long-term audit. Kept.
--
-- The lawful basis for processing past applicants' data is legitimate
-- interests (charitable purpose, prior engagement), documented separately in
-- the DPIA — not per-row consent.
-- =============================================================================

-- applications_wider view (from 0002) references consent_given — drop it
-- first, drop the column, then recreate the view without the column.
drop view if exists public.applications_wider;

alter table public.applications
  drop column if exists consent_given;

create view public.applications_wider
  with (security_invoker = false) as
select
  id,
  student_id,
  event_id,
  submitted_at,
  channel,
  status,
  consent_text_version,
  reviewed_at,
  created_