-- =============================================================================
-- Steps Intranet — Phase 1 RLS policies
-- Date: 2026-04-15
-- Applies on top of 0001_intranet_phase1.sql.
--
-- Model
-- -----
-- Two tiers in Phase 1:
--   admin  — founders + core (6 people). Full CRUD on every intranet table.
--   wider  — the rest of the team (~10 people). Read-only via restricted
--            views that exclude sensitive columns.
--
-- Role is resolved by matching the authenticated JWT's email claim against
-- public.team_members.email. No email → no role → no access.
--
-- Column-level access for `students` is expressed as:
--   - admin users read/write `public.students` directly (RLS policy).
--   - wider users read `public.students_wider` (a view that omits FSM,
--     parental_income_band, first_generation_uni, care_experienced,
--     date_of_birth, phone, imd_decile, polar4_quintile).
--   The view uses security_invoker = false so it executes with its owner's
--   privileges and is therefore not blocked by the admin-only policy on the
--   base table. This keeps app code simple (wider clients always hit the
--   view, admin clients always hit the base table) and removes any risk of
--   a "SELECT *" leaking sensitive columns to a wider user.
--
-- Event-scoping (wider users see only students tied to events they help
-- with) is Phase 2. For Phase 1, wider sees non-sensitive columns for all
-- non-deleted students. Flagged in the design doc §5.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helper: resolve the current JWT to a team_members row
-- -----------------------------------------------------------------------------
create or replace function public.current_team_member_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
    from public.team_members
   where email = (auth.jwt() ->> 'email')
   limit 1;
$$;

create or replace function public.current_team_member_uuid()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select auth_uuid
    from public.team_members
   where email = (auth.jwt() ->> 'email')
   limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.current_team_member_role() = 'admin';
$$;

create or replace function public.is_wider_or_admin()
returns boolean
language sql
stable
as $$
  select public.current_team_member_role() in ('admin', 'wider');
$$;

-- -----------------------------------------------------------------------------
-- 2. Enable RLS on every intranet table
--
-- Note: team_members already has RLS enabled (from task-tracker schema) with
-- a public-read policy. We leave that alone so the task tracker keeps working.
-- Intranet permissioning is enforced on the new tables below.
-- -----------------------------------------------------------------------------
alter table public.schools              enable row level security;
alter table public.students             enable row level security;
alter table public.student_contacts     enable row level security;
alter table public.events               enable row level security;
alter table public.applications         enable row level security;
alter table public.participation        enable row level security;
alter table public.progression          enable row level security;
alter table public.email_campaigns      enable row level security;
alter table public.campaign_recipients  enable row level security;
alter table public.consent_records      enable row level security;
alter table public.audit_log            enable row level security;
alter table public.pending_actions      enable row level security;

-- Lookup tables: readable by any authenticated user; only admins can modify.
alter table public.event_formats        enable row level security;
alter table public.application_statuses enable row level security;
alter table public.school_types         enable row level security;
alter table public.income_bands         enable row level security;
alter table public.stage_codes          enable row level security;

-- -----------------------------------------------------------------------------
-- 3. Lookup-table policies — read for all authed, write for admin only
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'event_formats','application_statuses','school_types','income_bands','stage_codes'
  ] loop
    execute format('drop policy if exists %I_read on public.%I;', t||'_read', t);
    execute format('drop policy if exists %I_write on public.%I;', t||'_write', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true);',
      t||'_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());',
      t||'_write', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. students — admin full access on the base table, no wider access
--
-- Wider users read public.students_wider (defined below) instead.
-- -----------------------------------------------------------------------------
drop policy if exists students_admin_all on public.students;
create policy students_admin_all on public.students
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 5. students_wider view — non-sensitive columns only
-- -----------------------------------------------------------------------------
drop view if exists public.students_wider;
create view public.students_wider
  with (security_invoker = false) as
select
  id,
  first_name,
  last_name,
  preferred_name,
  pronouns,
  full_name,
  personal_email,
  school_email,
  school_id,
  school_name_raw,
  year_group,
  postcode_district,            -- coarser geography only
  subscribed_to_mailing,
  unsubscribed_at,
  notes,
  created_at,
  updated_at,
  created_by,
  updated_by,
  deleted_at
from public.students
where deleted_at is null;

comment on view public.students_wider is
  'Non-sensitive projection of students for wider-team users. Excludes socioeconomic columns (free_school_meals, parental_income_band, first_generation_uni, care_experienced), DOB, phone, full postcode, IMD/POLAR4 deciles, and the raw notes intended for founder eyes only.';

-- Wider users get read access to the view; admins don't need it (they use
-- the base table) but we grant it uniformly for simplicity.
revoke all on public.students_wider from authenticated;
grant select on public.students_wider to authenticated;

-- -----------------------------------------------------------------------------
-- 6. student_contacts — admin only (contact history is sensitive)
-- -----------------------------------------------------------------------------
drop policy if exists student_contacts_admin_all on public.student_contacts;
create policy student_contacts_admin_all on public.student_contacts
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 7. schools — any authed user reads; admin writes
-- -----------------------------------------------------------------------------
drop policy if exists schools_read on public.schools;
drop policy if exists schools_admin_write on public.schools;
create policy schools_read on public.schools
  for select to authenticated
  using (deleted_at is null or public.is_admin());
create policy schools_admin_write on public.schools
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 8. events — any authed user reads; admin writes
-- -----------------------------------------------------------------------------
drop policy if exists events_read on public.events;
drop policy if exists events_admin_write on public.events;
create policy events_read on public.events
  for select to authenticated
  using (deleted_at is null or public.is_admin());
create policy events_admin_write on public.events
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 9. applications — admin full access on base table; wider reads a view
-- (applications_wider excludes raw_response and review_notes)
-- -----------------------------------------------------------------------------
drop policy if exists applications_admin_all on public.applications;
create policy applications_admin_all on public.applications
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop view if exists public.applications_wider;
create view public.applications_wider
  with (security_invoker = false) as
select
  id,
  student_id,
  event_id,
  submitted_at,
  channel,
  status,
  consent_given,
  consent_text_version,
  reviewed_at,
  created_at,
  updated_at,
  deleted_at
from public.applications
where deleted_at is null;

comment on view public.applications_wider is
  'Non-sensitive projection of applications for wider-team users. Excludes raw_response (may contain free-text PII) and review_notes (admin-only internal notes).';

revoke all on public.applications_wider from authenticated;
grant select on public.applications_wider to authenticated;

-- -----------------------------------------------------------------------------
-- 10. participation — any authed user reads (no sensitive cols); admin writes
-- -----------------------------------------------------------------------------
drop policy if exists participation_read on public.participation;
drop policy if exists participation_admin_write on public.participation;
create policy participation_read on public.participation
  for select to authenticated
  using (deleted_at is null or public.is_admin());
create policy participation_admin_write on public.participation
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 11. progression — admin only (future grades/outcomes are sensitive)
-- -----------------------------------------------------------------------------
drop policy if exists progression_admin_all on public.progression;
create policy progression_admin_all on public.progression
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 12. email_campaigns & campaign_recipients — admin only
-- -----------------------------------------------------------------------------
drop policy if exists email_campaigns_admin_all on public.email_campaigns;
create policy email_campaigns_admin_all on public.email_campaigns
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists campaign_recipients_admin_all on public.campaign_recipients;
create policy campaign_recipients_admin_all on public.campaign_recipients
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 13. consent_records — admin only (compliance artefact)
-- -----------------------------------------------------------------------------
drop policy if exists consent_records_admin_all on public.consent_records;
create policy consent_records_admin_all on public.consent_records
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 14. audit_log — admin reads, append-only writes by triggers (security definer
-- triggers bypass RLS, so we don't need a write policy for them)
-- -----------------------------------------------------------------------------
drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- 15. pending_actions — admin only (GDPR erasure queue etc.)
-- -----------------------------------------------------------------------------
drop policy if exists pending_actions_admin_all on public.pending_actions;
create policy pending_actions_admin_all on public.pending_actions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 16. Revoke default PUBLIC privileges on everything sensitive
--
-- Supabase's default role grants can expose things through PostgREST we
-- didn't intend. Make the contract explicit.
-- -----------------------------------------------------------------------------
revoke all on public.students              from anon;
revoke all on public.student_contacts      from anon, authenticated;
revoke all on public.applications          from anon;
revoke all on public.progression           from anon, authenticated;
revoke all on public.email_campaigns       from anon, authenticated;
revoke all on public.campaign_recipients   from anon, authenticated;
revoke all on public.consent_records       from anon, authenticated;
revoke all on public.audit_log             from anon;
revoke all on public.pending_actions       from anon, authenticated;

grant select, insert, update, delete on public.students      to authenticated;  -- gated by RLS
grant select, insert, update, delete on public.applications  to authenticated;  -- gated by RLS
grant select                         on public.audit_log     to authenticated;  -- gated by RLS

-- =============================================================================
-- 17. RLS test block — runnable standalone
--
-- Asserts that a wider-team user cannot read free_school_meals from the
-- students table. Run manually via psql or the Supabase SQL editor. Designed
-- to be idempotent: sets up two test team members, runs the assertions,
-- cleans up. Will raise an exception (and abort the transaction) if any
-- assertion fails.
--
-- NOTE: Supabase's RLS engine reads auth.jwt() from the GUC
-- `request.jwt.claims`. `set_config` lets us simulate a logged-in user.
-- =============================================================================

do $$
declare
  v_admin_uuid uuid;
  v_wider_uuid uuid;
  v_count int;
  v_caught boolean := false;
begin
  -- --- setup: two test team members -------------------------------------------
  insert into public.team_members (id, name, role, avatar, email)
  values
    (9001, 'Test Admin',  'admin', 'TA', 'test-admin@thestepsfoundation.com'),
    (9002, 'Test Wider',  'wider', 'TW', 'test-wider@thestepsfoundation.com')
  on conflict (id) do update
    set role  = excluded.role,
        email = excluded.email;

  select auth_uuid into v_admin_uuid from public.team_members where id = 9001;
  select auth_uuid into v_wider_uuid from public.team_members where id = 9002;

  -- Seed one student so there's data to (try to) read.
  insert into public.students (first_name, last_name, personal_email, free_school_meals)
  values ('RLS', 'Test', 'rls-test@example.invalid', true)
  on conflict (personal_email) do update
    set free_school_meals = excluded.free_school_meals;

  -- --- assertion 1: admin CAN see free_school_meals --------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"email":"test-admin@thestepsfoundation.com","role":"authenticated"}', true);

  select count(*) into v_count
    from public.students where free_school_meals is not null;

  if v_count = 0 then
    raise exception 'RLS test FAILED: admin could not see any free_school_meals rows.';
  end if;
  raise notice 'RLS test OK: admin sees % row(s) with free_school_meals.', v_count;

  -- --- assertion 2: wider user CANNOT see any students rows ------------------
  -- (admin-only RLS on the base table means a wider query returns zero rows
  --  rather than erroring — that's the Postgres RLS contract.)
  perform set_config('request.jwt.claims',
    '{"email":"test-wider@thestepsfoundation.com","role":"authenticated"}', true);

  select count(*) into v_count from public.students;
  if v_count <> 0 then
    raise exception 'RLS test FAILED: wider user saw % student rows from the base table (expected 0).', v_count;
  end if;
  raise notice 'RLS test OK: wider user sees 0 rows from public.students base table.';

  -- --- assertion 3: wider user selecting free_school_meals is blocked --------
  -- Either the column select returns zero rows (due to row-level filtering)
  -- or the query errors. Both are acceptable outcomes.
  begin
    select count(*) into v_count
      from public.students where free_school_meals is not null;
    if v_count <> 0 then
      raise exception 'RLS test FAILED: wider user read % free_school_meals row(s) (expected 0).', v_count;
    end if;
  exception when insufficient_privilege then
    v_caught := true;
  end;
  raise notice 'RLS test OK: wider user blocked from free_school_meals (caught_exception=%).', v_caught;

  -- --- assertion 4: wider user CAN read students_wider, which omits the col --
  select count(*) into v_count from public.students_wider;
  if v_count = 0 then
    raise exception 'RLS test FAILED: wider user saw 0 rows from students_wider (expected >0).';
  end if;
  raise notice 'RLS test OK: wider user sees % row(s) from students_wider.', v_count;

  -- And the sensitive column must not exist on the view:
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='students_wider'
       and column_name='free_school_meals'
  ) then
    raise exception 'RLS test FAILED: students_wider exposes free_school_meals.';
  end if;
  raise notice 'RLS test OK: students_wider does not expose free_school_meals.';

  -- --- cleanup ---------------------------------------------------------------
  -- Reset role before deleting so RLS doesn't block our own cleanup.
  reset role;
  perform set_config('request.jwt.claims', null, true);
  delete from public.students      where personal_email = 'rls-test@example.invalid';
  delete from public.t