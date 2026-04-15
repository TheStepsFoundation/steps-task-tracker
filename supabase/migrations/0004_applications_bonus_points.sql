-- =============================================================================
-- Steps Intranet — add applications.bonus_points and bonus_reason
-- Date: 2026-04-15
--
-- Lets admins manually adjust a student's engagement score per event by -1 or
-- +1 (e.g. "+1 for a great LinkedIn post after Starting Point", "-1 for a
-- no-show without notice"). The bonus is folded into engagement_score inside
-- the students_enriched view (0005).
-- =============================================================================

alter table public.applications
  add column if not exists bonus_points smallint not null default 0
    check (bonus_points between -1 and 1),
  add column if not exists bonus_reason text;

comment on column public.applications.bonus_points is
  'Manual engagement adjustment for this student/event: -1, 0, or +1. Added to engagement_score in students_enriched view.';
comment on column public.applications.bonus_reason is
  'Free-text explanation for the bonus_points value (e.g. "great LinkedIn post after Starting Point").';
