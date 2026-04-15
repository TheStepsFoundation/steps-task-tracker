-- =============================================================================
-- Steps Intranet — Phase 1 migration (schema)
-- Date: 2026-04-15
-- Author: Favour (with Claude)
--
-- Adds the student-database layer to the existing Supabase project
-- (rvspshqltnyormiqaidx). Sits alongside the task-tracker tables without
-- modifying them, except for additive, non-breaking extensions to
-- team_members (new columns only).
--
-- Isolation model
-- ---------------
-- Task tracker continues to use team_members.id (SERIAL int) as its
-- foreign-key target. Intranet tables FK to a new team_members.auth_uuid
-- (uuid) column so the whole student-database surface is uuid-keyed per
-- non-negotiable #1 in the Phase 1 design doc.
--
-- RLS policies live in 0002_intranet_phase1_rls.sql. Seed data in seed.sql.
--
-- To apply:
--   supabase db push
-- or paste this file into the Supabase SQL editor (followed by 0002).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive emails
create extension if not exists "pg_trgm";    -- fuzzy search on names

-- -----------------------------------------------------------------------------
-- 1. Enum-as-lookup tables
-- Used instead of Postgres ENUM types so new values don't need migrations.
-- -----------------------------------------------------------------------------
create table if not exists public.event_formats (
  code text primary key,
  label text not null,
  sort_order int not null default 0
);
insert into public.event_formats (code, label, sort_order) values
  ('in_person', 'In person', 10),
  ('online',    'Online',    20),
  ('hybrid',    'Hybrid',    30)
on conflict (code) do nothing;

create table if not exists public.application_statuses (
  code text primary key,
  label text not null,
  is_terminal bool not null default false,
  sort_order int not null default 0
);
insert into public.application_statuses (code, label, is_terminal, sort_order) values
  ('submitted',   'Submitted',   false, 10),
  ('shortlisted', 'Shortlisted', false, 20),
  ('accepted',    'Accepted',    false, 30),
  ('waitlist',    'Waitlist',    false, 40),
  ('rejected',    'Rejected',    true,  50),
  ('withdrew',    'Withdrew',    true,  60)
on conflict (code) do nothing;

create table if not exists public.school_types (
  code text primary key,
  label text not null,
  sort_order int not null default 0
);
insert into public.school_types (code, label, sort_order) values
  ('state',        'State',               10),
  ('grammar',      'Grammar',             20),
  ('independent',  'Independent',         30),
  ('sixth_form',   'Sixth-form college',  40),
  ('fe_college',   'FE college',          50),
  ('academy',      'Academy',             60),
  ('other',        'Other',               90)
on conflict (code) do nothing;

create table if not exists public.income_bands (
  code text primary key,
  label text not null,
  sort_order int not null default 0
);
insert into public.income_bands (code, label, sort_order) values
  ('under_20k', 'Under £20,000',       10),
  ('20_40k',    '£20,000 – £40,000',   20),
  ('40_60k',    '£40,000 – £60,000',   30),
  ('60_100k',   '£60,000 – £100,000',  40),
  ('over_100k', 'Over £100,000',       50),
  ('prefer_na', 'Prefer not to say',   90)
on conflict (code) do nothing;

create table if not exists public.stage_codes (
  code text primary key,
  label text not null,
  sort_order int not null default 0
);
insert into public.stage_codes (code, label, sort_order) values
  ('y10',    'Year 10',        10),
  ('y11',    'Year 11',        20),
  ('y12',    'Year 12',        30),
  ('y13',    'Year 13',        40),
  ('gap',    'Gap year',       50),
  ('uni_y1', 'University Y1',  60),
  ('uni_y2', 'University Y2',  70),
  ('uni_y3', 'University Y3',  80),
  ('uni_y4', 'University Y4',  90),
  ('alum',   'Alumni',        100)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 2. team_members — additive extension only
--
-- - role: admin / wider / mentor  (drives RLS)
-- - email: Google account email (drives JWT → team_member resolution)
-- - auth_uuid: stable uuid surrogate for intranet FK targets. Unrelated to
--   auth.users.id; we generate it ourselves so we can reference team_members
--   with uuid FKs without rewriting the task-tracker int-PK schema.
-- -----------------------------------------------------------------------------
alter table public.team_members
  add column if not exists role text not null default 'wider'
    check (role in ('admin', 'wider', 'mentor'));

alter table public.team_members
  add column if not exists email citext unique;

alter table public.team_members
  add column if not exists auth_uuid uuid unique not null default gen_random_uuid();

comment on column public.team_members.role is
  'Access tier: admin (founders+core), wider (scoped read-only), mentor (Phase 2).';
comment on column public.team_members.email is
  'Google account email. Used to resolve the authenticated JWT to a team_member for RLS and audit.';
comment on column public.team_members.auth_uuid is
  'Stable uuid surrogate used as FK target from uuid-keyed intranet tables. Independent of auth.users.id.';

-- Bump founders + core (ids 1–6) to admin. Everyone added after them stays on
-- the 'wider' default until explicitly promoted.
update public.team_members set role = 'admin' where id <= 6 and role <> 'admin';

-- -----------------------------------------------------------------------------
-- 3. schools — canonical school reference
-- -----------------------------------------------------------------------------
create table if not exists public.schools (
  id              uuid primary key default gen_random_uuid(),
  urn             int unique,                           -- DfE Unique Reference Number
  name            text not null,
  type            text references public.school_types(code),
  postcode        text,
  local_authority text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.team_members(auth_uuid),
  updated_by      uuid references public.team_members(auth_uuid),
  deleted_at      timestamptz
);
create index if not exists schools_name_trgm_idx on public.schools using gin (name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 4. students — core identity table
-- -----------------------------------------------------------------------------
create table if not exists public.students (
  id                       uuid primary key default gen_random_uuid(),

  -- Identity
  first_name               text not null,
  last_name                text not null,
  preferred_name           text,
  pronouns                 text,
  full_name                text generated always as (
    trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))
  ) stored,
  date_of_birth            date,

  -- Contact (primary; history kept in student_contacts)
  personal_email           citext unique,
  school_email             citext,
  phone                    text,

  -- School & year
  school_id                uuid references public.schools(id) on delete set null,
  school_name_raw          text,                 -- what the student typed in the form
  year_group               int,

  -- Geography
  postcode                 text,
  postcode_district        text,                 -- derived via trigger
  imd_decile               int check (imd_decile between 1 and 10),
  polar4_quintile          int check (polar4_quintile between 1 and 5),

  -- Socioeconomic (admin-only via RLS; excluded from students_wider view)
  free_school_meals        bool,
  parental_income_band     text references public.income_bands(code),
  first_generation_uni     bool,
  care_experienced         bool,

  -- Lifecycle
  subscribed_to_mailing    bool not null default true,
  unsubscribed_at          timestamptz,
  unsubscribe_source       text,
  erased_at                timestamptz,          -- GDPR Art 17 marker
  retention_review_date    date,

  -- Freeform
  notes                    text,

  -- Audit
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references public.team_members(auth_uuid),
  updated_by               uuid references public.team_members(auth_uuid),
  deleted_at               timestamptz
);

-- Lawful-basis documentation (per non-negotiable #3)
comment on column public.students.personal_email        is 'Lawful basis: legitimate interests (charitable purpose) + consent at intake.';
comment on column public.students.school_email          is 'Lawful basis: legitimate interests. Secondary contact for under-18 applicants.';
comment on column public.students.phone                 is 'Lawful basis: explicit consent at intake. Used only for event-day logistics.';
comment on column public.students.date_of_birth         is 'Lawful basis: legitimate interests. Used for dedupe and age-gated eligibility.';
comment on column public.students.postcode              is 'Lawful basis: legitimate interests. Feeds IMD/POLAR4 derivation for impact reporting.';
comment on column public.students.postcode_district     is 'Derived from postcode. Coarser geography used for aggregate impact stats.';
comment on column public.students.free_school_meals     is 'Lawful basis: explicit consent at intake. Admin-only via RLS (excluded from students_wider view).';
comment on column public.students.parental_income_band  is 'Lawful basis: explicit consent at intake. Admin-only via RLS.';
comment on column public.students.first_generation_uni  is 'Lawful basis: explicit consent at intake. Admin-only via RLS.';
comment on column public.students.care_experienced      is 'Lawful basis: explicit consent at intake. Special-category-adjacent. Admin-only via RLS.';

create index if not exists students_email_idx         on public.students (personal_email);
create index if not exists students_full_name_trgm    on public.students using gin (full_name gin_trgm_ops);
create index if not exists students_school_idx        on public.students (school_id);
create index if not exists students_year_group_idx    on public.students (year_group);
create index if not exists students_deleted_at_idx    on public.students (deleted_at) where deleted_at is null;
create index if not exists students_subscribed_idx    on public.students (subscribed_to_mailing) where subscribed_to_mailing = true;

-- -----------------------------------------------------------------------------
-- 5. student_contacts — append-only history of email/phone over time
-- (Intentionally append-only: row lifecycle modelled via valid_from/valid_to,
--  so we omit updated_by / deleted_at and instead rely on audit_log for changes.)
-- -----------------------------------------------------------------------------
create table if not exists public.student_contacts (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students(id) on delete cascade,
  kind         text not null check (kind in ('email', 'phone')),
  value        text not null,
  is_primary   bool not null default false,
  valid_from   date not null default current_date,
  valid_to     date,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.team_members(auth_uuid)
);
create index if not exists student_contacts_student_idx on public.student_contacts (student_id);
create index if not exists student_contacts_value_idx   on public.student_contacts (value);

-- -----------------------------------------------------------------------------
-- 6. events
-- -----------------------------------------------------------------------------
create table if not exists public.events (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  slug                    text unique not null,
  event_date              date,
  location                text,
  format                  text references public.event_formats(code),
  description             text,
  capacity                int,
  applications_open_at    timestamptz,
  applications_close_at   timestamptz,
  lead_team_member_id     uuid references public.team_members(auth_uuid),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references public.team_members(auth_uuid),
  updated_by              uuid references public.team_members(auth_uuid),
  deleted_at              timestamptz
);
create index if not exists events_date_idx on public.events (event_date);

-- -----------------------------------------------------------------------------
-- 7. applications — one per form submission
-- -----------------------------------------------------------------------------
create table if not exists public.applications (
  id                      uuid primary key default gen_random_uuid(),
  student_id              uuid not null references public.students(id) on delete restrict,
  event_id                uuid not null references public.events(id) on delete restrict,
  submitted_at            timestamptz not null default now(),
  channel                 text,                       -- source tracking (e.g. "man_group_alumni")
  raw_response            jsonb not null default '{}'::jsonb,
  status                  text not null default 'submitted' references public.application_statuses(code),
  reviewed_by             uuid references public.team_members(auth_uuid),
  reviewed_at             timestamptz,
  review_notes            text,

  -- Consent at time of application (snapshot — does not change if student later edits)
  consent_given           bool not null,
  consent_text_version    text not null,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references public.team_members(auth_uuid),
  updated_by              uuid references public.team_members(auth_uuid),
  deleted_at              timestamptz,

  unique (student_id, event_id)   -- one application per student per event
);
comment on column public.applications.raw_response is
  'Full form payload as submitted. May contain PII; admin-only (not exposed via applications_wider view).';
comment on column public.applications.review_notes is
  'Internal reviewer notes. Admin-only (not exposed via applications_wider view).';

create index if not exists applications_student_idx   on public.applications (student_id);
create index if not exists applications_event_idx     on public.applications (event_id);
create index if not exists applications_status_idx    on public.applications (status);
create index if not exists applications_channel_idx   on public.applications (channel);
create index if not exists applications_submitted_idx on public.applications (submitted_at desc);

-- -----------------------------------------------------------------------------
-- 8. participation — did they actually show up
-- -----------------------------------------------------------------------------
create table if not exists public.participation (
  id                 uuid primary key default gen_random_uuid(),
  application_id     uuid not null unique references public.applications(id) on delete cascade,
  attended           bool,
  no_show            bool,
  arrival_time       timestamptz,
  departure_time     timestamptz,
  feedback_score     int check (feedback_score between 1 and 10),
  feedback_text      text,
  photos_consent     bool,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.team_members(auth_uuid),
  updated_by         uuid references public.team_members(auth_uuid),
  deleted_at         timestamptz
);

-- -----------------------------------------------------------------------------
-- 9. progression — scaffold for Phase 2 outcome tracking (admin-only)
-- -----------------------------------------------------------------------------
create table if not exists public.progression (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references public.students(id) on delete cascade,
  as_of_date         date not null default current_date,
  current_stage      text references public.stage_codes(code),
  a_level_subjects   text[],
  predicted_grades   jsonb,
  actual_grades      jsonb,
  ucas_choices       jsonb,
  firm_choice        text,
  insurance_choice   text,
  outcome            text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.team_members(auth_uuid),
  updated_by         uuid references public.team_members(auth_uuid),
  deleted_at         timestamptz
);
create index if not exists progression_student_idx on public.progression (student_id);

-- -----------------------------------------------------------------------------
-- 10. email_campaigns & campaign_recipients
-- -----------------------------------------------------------------------------
create table if not exists public.email_campaigns (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  subject              text,
  body_template        text,
  sent_at              timestamptz,
  sent_by              uuid references public.team_members(auth_uuid),
  audience_query       jsonb,                 -- the filter used to build the list
  recipient_count      int not null default 0,
  unsubscribe_count    int not null default 0,
  bounce_count         int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references public.team_members(auth_uuid),
  updated_by           uuid references public.team_members(auth_uuid),
  deleted_at           timestamptz
);

create table if not exists public.campaign_recipients (
  id                   uuid primary key default gen_random_uuid(),
  campaign_id          uuid not null references public.email_campaigns(id) on delete cascade,
  student_id           uuid not null references public.students(id) on delete cascade,
  unsubscribe_token    text unique not null,
  delivered_at         timestamptz,
  opened_at            timestamptz,
  clicked_at           timestamptz,
  unsubscribed_at      timestamptz,
  bounced_at           timestamptz,
  created_at           timestamptz not null default now(),
  unique (campaign_id, student_id)
);
create index if not exists campaign_recipients_campaign_idx on public.campaign_recipients (campaign_id);
create index if not exists campaign_recipients_student_idx  on public.campaign_recipients (student_id);

-- -----------------------------------------------------------------------------
-- 11. consent_records — append-only, versioned consent history per student
-- -----------------------------------------------------------------------------
create table if not exists public.consent_records (
  id                     uuid primary key default gen_random_uuid(),
  student_id             uuid not null references public.students(id) on delete cascade,
  application_id         uuid references public.applications(id) on delete set null,
  consent_text           text not null,
  consent_text_version   text not null,
  given_at               timestamptz not null default now(),
  ip_address             inet,
  withdrawn_at           timestamptz,
  withdrawal_reason      text
);
create index if not exists consent_records_student_idx on public.consent_records (student_id);

-- -----------------------------------------------------------------------------
-- 12. audit_log — append-only record of every mutation
-- -----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  table_name   text not null,
  row_id       uuid,
  operation    text not null check (operation in ('insert','update','delete','read')),
  changed_by   uuid references public.team_members(auth_uuid),
  changed_at   timestamptz not null default now(),
  before       jsonb,
  after        jsonb,
  reason       text
);
create index if not exists audit_log_table_row_idx  on public.audit_log (table_name, row_id);
create index if not exists audit_log_changed_at_idx on public.audit_log (changed_at desc);

-- -----------------------------------------------------------------------------
-- 13. pending_actions — two-admin approval queue (e.g. GDPR erasure)
-- -----------------------------------------------------------------------------
create table if not exists public.pending_actions (
  id                  uuid primary key default gen_random_uuid(),
  action_type         text not null check (action_type in ('gdpr_erasure','bulk_export','bulk_delete')),
  target_table        text not null,
  target_row_id       uuid,
  payload             jsonb,
  requested_by        uuid not null references public.team_members(auth_uuid),
  requested_at        timestamptz not null default now(),
  approved_by         uuid references public.team_members(auth_uuid),
  approved_at         timestamptz,
  executed_at         timestamptz,
  cancelled_at        timestamptz,
  reason              text
);
create index if not exists pending_actions_type_idx on public.pending_actions (action_type, executed_at);

-- -----------------------------------------------------------------------------
-- 14. Triggers — updated_at + postcode district + audit log
-- -----------------------------------------------------------------------------

-- Generic updated_at trigger
create or replace function public.tg_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

-- Derive postcode_district from postcode
create or replace function public.tg_derive_postcode_district()
returns trigger as $$
begin
  if new.postcode is not null and new.postcode is distinct from coalesce(old.postcode, '') then
    new.postcode_district := upper(split_part(trim(new.postcode), ' ', 1));
  end if;
  return new;
end;
$$ language plpgsql;

-- Audit-log trigger: writes to audit_log on every insert/update/delete.
-- Resolves actor by JWT email → team_members.auth_uuid. Null when unresolved
-- (e.g. service-role writes, ingestion function, or seed inserts).
create or replace function public.tg_audit_log()
returns trigger as $$
declare
  v_actor uuid;
begin
  begin
    v_actor := (select auth_uuid from public.team_members
                 where email = auth.jwt() ->> 'email' limit 1);
  exception when others then
    v_actor := null;
  end;

  if tg_op = 'INSERT' then
    insert into public.audit_log (table_name, row_id, operation, changed_by, after)
    values (tg_table_name, new.id, 'insert', v_actor, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (table_name, row_id, operation, changed_by, before, after)
    values (tg_table_name, new.id, 'update', v_actor, to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (table_name, row_id, operation, changed_by, before)
    values (tg_table_name, old.id, 'delete', v_actor, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

-- Attach updated_at triggers
do $$
declare
  t text;
begin
  foreach t in array array[
    'schools','students','events','applications','participation',
    'progression','email_campaigns'
  ]
  loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();',
      t, t);
  end loop;
end $$;

-- Attach postcode-district trigger
drop trigger if exists derive_postcode_district on public.students;
create trigger derive_postcode_district
  before insert or update of postcode on public.students
  for each row execute function public.tg_derive_postcode_district();

-- Attach audit-log triggers on every table that represents a meaningful mutation.
-- (audit_log itself is excluded — we don't audit the audit trail.)
do $$
declare
  t text;
begin
  foreach t in array array[
    'students','student_contacts','schools','events','applications',
    'participation','progression','email_campaigns','campaign_recipients',
    'consent_records','pending_actions'
  ]
  loop
    execute format(
      'drop trigger if exists audit_log_trigger on public.%I;
       create trigger audit_log_trigger
         after insert or update or delete on public.%I
         for each row execute function public.tg_audit_log();',
      t, t);
  end loop;
end $$;
