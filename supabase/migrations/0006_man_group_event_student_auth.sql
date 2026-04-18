-- =============================================================================
-- Steps Intranet — Man Group Office Visit + Student Self-Service Auth
-- Date: 2026-04-18
--
-- 1. Inserts the Man Group Office Visit event (#5).
-- 2. Adds "independent_bursary" school type (independent with >90% bursary).
-- 3. Adds student self-service RLS policies so OTP-authenticated students can:
--      • Read their own student record
--      • Create their own student record (first-time applicants)
--      • Update their own record (name, school, year group, socioeconomic)
--      • Create applications for themselves
--      • Read their own applications
--    Events and schools are already readable by any authenticated user (0002).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. New school type: independent with >90% bursary
-- -----------------------------------------------------------------------------
INSERT INTO public.school_types (code, label, sort_order) VALUES
  ('independent_bursary', 'Independent (>90% bursary)', 35)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Man Group Office Visit event
-- -----------------------------------------------------------------------------
INSERT INTO public.events (
  id, name, slug, event_date, location, format, description, capacity,
  applications_open_at
) VALUES (
  'b5e7f8a1-3c9d-4b2e-8f1a-6d7c8e9f0a1b',
  '#5 Man Group Office Visit',
  'man-group-office-visit',
  '2026-07-08',
  'Riverbank House, 2 Swan Lane, London EC4R 3AD',
  'in_person',
  'A one-day office visit to Man Group in partnership with The Steps Foundation. Features an Art of Selling workshop, trading game, office tour, networking, and early careers presentation covering apprenticeship and graduate routes.',
  25,
  now()
) ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Student self-service RLS policies — students table
--
-- A student authenticates via email OTP. Their JWT email claim matches
-- students.personal_email. These policies are additive (OR'd with the
-- existing admin policy from 0002).
-- -----------------------------------------------------------------------------

-- Students can read their own row
DROP POLICY IF EXISTS students_self_select ON public.students;
CREATE POLICY students_self_select ON public.students
  FOR SELECT TO authenticated
  USING (
    personal_email = lower(auth.jwt() ->> 'email')
    AND deleted_at IS NULL
  );

-- Students can create their own record on first application
DROP POLICY IF EXISTS students_self_insert ON public.students;
CREATE POLICY students_self_insert ON public.students
  FOR INSERT TO authenticated
  WITH CHECK (
    personal_email = lower(auth.jwt() ->> 'email')
  );

-- Students can update their own record
-- Column-level restrictions enforced at application layer (Phase 2: move to
-- a security-definer function for defence-in-depth).
DROP POLICY IF EXISTS students_self_update ON public.students;
CREATE POLICY students_self_update ON public.students
  FOR UPDATE TO authenticated
  USING (
    personal_email = lower(auth.jwt() ->> 'email')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    personal_email = lower(auth.jwt() ->> 'email')
  );

-- -----------------------------------------------------------------------------
-- 4. Student self-service RLS policies — applications table
-- -----------------------------------------------------------------------------

-- Students can read their own applications
DROP POLICY IF EXISTS applications_self_select ON public.applications;
CREATE POLICY applications_self_select ON public.applications
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT id FROM public.students
      WHERE personal_email = lower(auth.jwt() ->> 'email')
    )
    AND deleted_at IS NULL
  );

-- Students can create applications for themselves
DROP POLICY IF EXISTS applications_self_insert ON public.applications;
CREATE POLICY applications_self_insert ON public.applications
  FOR INSERT TO authenticated
  WITH CHECK (
    student_id IN (
      SELECT id FROM public.students
      WHERE personal_email = lower(auth.jwt() ->> 'email')
    )
  );

-- -----------------------------------------------------------------------------
-- 5. Update students_enriched view to include school_type
--
-- The existing view (0005) doesn't include school_type or school join columns.
-- We recreate it with those additions so the admin dashboard can display
-- school type info from the enriched view.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.students_enriched;
CREATE VIEW public.students_enriched
  WITH (security_invoker = true) AS
SELECT
  s.id,
  s.first_name,
  s.last_name,
  s.personal_email,
  s.school_name_raw,
  s.school_id,
  s.year_group,
  s.free_school_meals,
  s.parental_income_band,
  s.first_generation_uni,
  s.subscribed_to_mailing,
  s.school_type,
  s.bursary_90plus,
  s.notes,
  s.created_at,
  -- School join columns
  sch.name   AS school_name,
  sch.type   AS school_type_group,
  -- Aggregates
  coalesce(sum(case when a.attended then 1 else 0 end), 0)::int AS attended_count,
  coalesce(sum(case when a.status = 'accepted' then 1 else 0 end), 0)::int AS accepted_count,
  coalesce(sum(case when a.status = 'submitted' then 1 else 0 end), 0)::int AS submitted_count,
  coalesce(sum(case when a.status = 'rejected' then 1 else 0 end), 0)::int AS rejected_count,
  coalesce(sum(case
    when e.event_date < current_date
     AND a.status = 'accepted'
     AND coalesce(a.attended, false) = false
    then 1 else 0 end), 0)::int AS no_show_count,
  coalesce(sum(
    case
      when a.attended then 2
      when a.status = 'accepted' and e.event_date <  current_date then -1
      when a.status = 'accepted' and e.event_date >= current_date then  1
      else 0
    end
    + coalesce(a.bonus_points, 0)
  ), 0)::int AS engagement_score,
  coalesce(sum(coalesce(a.bonus_points, 0)), 0)::int AS bonus_total,
  max(a.submitted_at) AS last_activity,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'student_id', a.student_id,
        'event_id', a.event_id,
        'status', a.status,
        'attended', a.attended,
        'submitted_at', a.submitted_at,
        'attribution_source', a.attribution_source,
        'bonus_points', a.bonus_points,
        'bonus_reason', a.bonus_reason
      ) ORDER BY e.event_date
    ) FILTER (WHERE a.id IS NOT NULL),
    '[]'::jsonb
  ) AS applications
FROM public.students s
LEFT JOIN public.schools sch ON sch.id = s.school_id
LEFT JOIN public.applications a
  ON a.student_id = s.id AND a.deleted_at IS NULL
LEFT JOIN public.events e
  ON e.id = a.event_id
WHERE s.deleted_at IS NULL
GROUP BY s.id, sch.name, sch.type;

COMMENT ON VIEW public.students_enriched IS
  'One row per student with pre-aggregated engagement counts, scores, school info, and an inline JSON array of their applications.';

GRANT SELECT ON public.students_enriched TO authenticated;
