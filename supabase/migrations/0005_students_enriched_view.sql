-- =============================================================================
-- Steps Intranet — students_enriched view
-- Date: 2026-04-15
--
-- Pre-computed per-student engagement aggregates plus their applications
-- inline as JSON. Replaces the dashboard's previous two-fetch pattern
-- (students + applications, paginated) with a single query. ~2k students +
-- ~2k applications => ~1 round-trip instead of ~6.
--
-- engagement_score logic (mirrors src/lib/students-api.ts#enrich):
--   attended                 -> +2
--   accepted + past event    -> -1 (no-show)
--   accepted + future event  -> +1
--   else                     -> 0
-- plus applications.bonus_points (-1 / 0 / +1) per application.
-- =============================================================================

drop view if exists public.students_enriched;
create view public.students_enriched
  with (security_invoker = true) as
select
  s.id,
  s.first_name,
  s.last_name,
  s.personal_email,
  s.school_name_raw,
  s.year_group,
  s.free_school_meals,
  s.parental_income_band,
  s.first_generation_uni,
  s.subscribed_to_mailing,
  s.notes,
  s.created_at,
  coalesce(sum(case when a.attended then 1 else 0 end), 0)::int as attended_count,
  coalesce(sum(case when a.status = 'accepted' then 1 else 0 end), 0)::int as accepted_count,
  coalesce(sum(case when a.status = 'submitted' then 1 else 0 end), 0)::int as submitted_count,
  coalesce(sum(case when a.status = 'rejected' then 1 else 0 end), 0)::int as rejected_count,
  coalesce(sum(case
    when e.event_date < current_date
     and a.status = 'accepted'
     and coalesce(a.attended, false) = false
    then 1 else 0 end), 0)::int as no_show_count,
  coalesce(sum(
    case
      when a.attended then 2
      when a.status = 'accepted' and e.event_date <  current_date then -1
      when a.status = 'accepted' and e.event_date >= current_date then  1
      else 0
    end
    + coalesce(a.bonus_points, 0)
  ), 0)::int as engagement_score,
  coalesce(sum(coalesce(a.bonus_points, 0)), 0)::int as bonus_total,
  max(a.submitted_at) as last_activity,
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
      ) order by e.event_date
    ) filter (where a.id is not null),
    '[]'::jsonb
  ) as applications
from public.students s
left join public.applications a
  on a.student_id = s.id and a.deleted_at is null
left join public.events e
  on e.id = a.event_id
where s.deleted_at is null
group by s.id;

comment on view public.students_enriched is
  'One row per student with pre-aggregated engagement counts, scores, and an inline JSON array of their applications. Used by the Student Database dashboard to avoid a double round-trip.';

grant select on public.students_enriched to authenticated;
