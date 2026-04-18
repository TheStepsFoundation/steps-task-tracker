-- =============================================================================
-- Steps Intranet — Events Hub: schema additions
-- Date: 2026-04-18
--
-- Adds tables and columns for the Events Hub module:
--   1. events table enhancements (time_start, time_end, dress_code, status)
--   2. email_templates — reusable email templates with merge tags
--   3. email_log — per-student email send history
--   4. application_status_history — audit trail for status changes
--   5. application_rsvp — attendance confirmation by students
--   6. RLS policies for all new tables
--   7. Audit triggers for all new tables
--
-- Depends on: 0001 (base schema), 0002 (RLS), 0006 (events + student auth)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. events table enhancements
-- -----------------------------------------------------------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS time_start text,
  ADD COLUMN IF NOT EXISTS time_end text,
  ADD COLUMN IF NOT EXISTS dress_code text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed', 'completed'));

COMMENT ON COLUMN public.events.time_start IS 'Event start time as text, e.g. "09:30".';
COMMENT ON COLUMN public.events.time_end IS 'Event end time as text, e.g. "15:30".';
COMMENT ON COLUMN public.events.dress_code IS 'Dress code for the event, shown in confirmation emails.';
COMMENT ON COLUMN public.events.status IS 'Event lifecycle: draft (not visible), open (accepting apps), closed (no new apps), completed (past).';

-- Update Man Group event with its details
UPDATE public.events
SET
  time_start = '09:30',
  time_end = '15:30',
  dress_code = 'Smart casual',
  status = 'open'
WHERE id = 'b5e7f8a1-3c9d-4b2e-8f1a-6d7c8e9f0a1b';

-- -----------------------------------------------------------------------------
-- 2. email_templates — reusable per-event or generic templates with merge tags
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  type            text NOT NULL CHECK (type IN (
                    'acceptance', 'rejection', 'waitlist',
                    'reminder', 'follow_up', 'custom'
                  )),
  subject         text NOT NULL,
  body_html       text NOT NULL,
  body_text       text,
  event_id        uuid REFERENCES public.events(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.team_members(auth_uuid),
  updated_by      uuid REFERENCES public.team_members(auth_uuid),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS email_templates_event_idx ON public.email_templates (event_id);
CREATE INDEX IF NOT EXISTS email_templates_type_idx ON public.email_templates (type);

COMMENT ON TABLE public.email_templates IS
  'Reusable email templates with merge tags ({{first_name}}, {{event_name}}, etc.). event_id NULL = generic template.';

-- -----------------------------------------------------------------------------
-- 3. email_log — per-student send history (individual, not campaign)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  event_id        uuid REFERENCES public.events(id) ON DELETE SET NULL,
  template_id     uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,
  to_email        text NOT NULL,
  from_email      text NOT NULL DEFAULT 'events@thestepsfoundation.com',
  subject         text NOT NULL,
  body_html       text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  gmail_message_id text,
  sent_at         timestamptz,
  sent_by         uuid REFERENCES public.team_members(auth_uuid),
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_log_student_idx ON public.email_log (student_id);
CREATE INDEX IF NOT EXISTS email_log_event_idx ON public.email_log (event_id);
CREATE INDEX IF NOT EXISTS email_log_status_idx ON public.email_log (status);
CREATE INDEX IF NOT EXISTS email_log_sent_at_idx ON public.email_log (sent_at DESC);

COMMENT ON TABLE public.email_log IS
  'Per-student email send log. Stores the rendered (merge-tag-resolved) subject and body. Links back to template and event.';

-- -----------------------------------------------------------------------------
-- 4. application_status_history — audit trail for application status changes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_status_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  old_status      text,
  new_status      text NOT NULL REFERENCES public.application_statuses(code),
  changed_by      uuid REFERENCES public.team_members(auth_uuid),
  email_log_id    uuid REFERENCES public.email_log(id) ON DELETE SET NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_status_history_app_idx ON public.application_status_history (application_id);
CREATE INDEX IF NOT EXISTS app_status_history_created_idx ON public.application_status_history (created_at DESC);

COMMENT ON TABLE public.application_status_history IS
  'Every application status change is logged here with who changed it, when, optional note, and link to notification email if one was sent.';

-- -----------------------------------------------------------------------------
-- 5. application_rsvp — student attendance confirmation
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_rsvp (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL UNIQUE REFERENCES public.applications(id) ON DELETE CASCADE,
  confirmed             boolean NOT NULL DEFAULT false,
  confirmed_at          timestamptz,
  dietary_requirements  text,
  accessibility_needs   text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_rsvp_app_idx ON public.application_rsvp (application_id);

COMMENT ON TABLE public.application_rsvp IS
  'One-to-one with applications. Created when acceptance email is sent. Student confirms via portal.';

-- -----------------------------------------------------------------------------
-- 6. Triggers — updated_at for new tables
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_templates', 'application_rsvp']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON public.%I;
       CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();',
      t, t);
  END LOOP;
END $$;

-- Audit-log triggers for new tables
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'email_templates', 'email_log', 'application_status_history', 'application_rsvp'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_log_trigger ON public.%I;
       CREATE TRIGGER audit_log_trigger
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.tg_audit_log();',
      t, t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 7. RLS policies
--
-- Pattern: admin team members (role = 'admin') get full CRUD.
-- Students get read-only on their own email_log and rsvp rows.
-- email_templates readable by all authenticated users (needed for portal).
-- -----------------------------------------------------------------------------

-- email_templates: enable RLS
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_templates_admin_all ON public.email_templates;
CREATE POLICY email_templates_admin_all ON public.email_templates
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE email = auth.jwt() ->> 'email'
        AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE email = auth.jwt() ->> 'email'
        AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS email_templates_read ON public.email_templates;
CREATE POLICY email_templates_read ON public.email_templates
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

-- email_log: enable RLS
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_log_admin_all ON public.email_log;
CREATE POLICY email_log_admin_all ON public.email_log
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE email = auth.jwt() ->> 'email'
        AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE email = auth.jwt() ->> 'email'
        AND role = 'admin'
    )
  );

-- Students can read their own email log entries
DROP POLICY IF EXISTS email_log_self_select ON public.email_log;
CREATE POLICY email_log_self_select ON public.email_log
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT id FROM public.students
      WHERE personal_email = lower(auth.jwt() ->> 'email')
    )
  );

-- application_status_history: enable RLS
ALTER TABLE public.application_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_status_history_admin_all ON public.application_status_history;
CREATE POLICY app_status_history_admin_all ON public.application_status_history
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE email = auth.jwt() ->> 'email'
        AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE email = auth.jwt() ->> 'email'
        AND role = 'admin'
    )
  );

-- application_rsvp: enable RLS
ALTER TABLE public.application_rsvp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_rsvp_admin_all ON public.application_rsvp;
CREATE POLICY app_rsvp_admin_all ON public.application_rsvp
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE email = auth.jwt() ->> 'email'
        AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE email = auth.jwt() ->> 'email'
        AND role = 'admin'
    )
  );

-- Students can read and update their own RSVP
DROP POLICY IF EXISTS app_rsvp_self_select ON public.application_rsvp;
CREATE POLICY app_rsvp_self_select ON public.application_rsvp
  FOR SELECT TO authenticated
  USING (
    application_id IN (
      SELECT a.id FROM public.applications a
      JOIN public.students s ON s.id = a.student_id
      WHERE s.personal_email = lower(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS app_rsvp_self_update ON public.application_rsvp;
CREATE POLICY app_rsvp_self_update ON public.application_rsvp
  FOR UPDATE TO authenticated
  USING (
    application_id IN (
      SELECT a.id FROM public.applications a
      JOIN public.students s ON s.id = a.student_id
      WHERE s.personal_email = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    application_id IN (
      SELECT a.id FROM public.applications a
      JOIN public.students s ON s.id = a.student_id
      WHERE s.personal_email = lower(auth.jwt() ->> 'email')
    )
  );

-- Grant access to authenticated role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates TO authenticated;
GRANT SELECT, INSERT ON public.email_log TO authenticated;
GRANT SELECT, INSERT ON public.application_status_history TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.application_rsvp TO authenticated;
