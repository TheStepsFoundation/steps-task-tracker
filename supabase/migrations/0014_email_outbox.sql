-- ---------------------------------------------------------------------------
-- 0014_email_outbox.sql
--
-- Server-side email queue. The compose modal no longer sends emails inline —
-- it bulk-inserts rows here and returns immediately. A worker (Vercel API
-- endpoint at /api/process-email-queue) is polled by Supabase pg_cron every
-- minute, claims a batch via FOR UPDATE SKIP LOCKED, sends via Gmail, and
-- writes the permanent record to email_log.
--
-- Pacing: Gmail API tops out around 150 msgs/min for a Workspace sender
-- before hitting 429s; 50/min is a safe cruise rate and gives us room for
-- retries on transient failures.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who queued this, and what it relates to
  queued_by         uuid REFERENCES public.team_members(auth_uuid),
  event_id          uuid REFERENCES public.events(id) ON DELETE CASCADE,
  application_id    uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  student_id        uuid REFERENCES public.students(id) ON DELETE SET NULL,
  template_id       uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,

  -- The actual message (merge tags already resolved when queued)
  to_email          text NOT NULL,
  from_email        text NOT NULL DEFAULT 'events@thestepsfoundation.com',
  subject           text NOT NULL,
  body_html         text NOT NULL,

  -- Queue state
  status            text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts          integer NOT NULL DEFAULT 0,
  max_attempts      integer NOT NULL DEFAULT 3,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  last_error        text,

  -- Populated when worker completes a send
  gmail_message_id  text,
  email_log_id      uuid REFERENCES public.email_log(id) ON DELETE SET NULL,

  -- Optional: status to apply to the application after successful send.
  -- Note: for now the frontend applies status changes immediately on queue
  -- (matches current UX); this column is reserved for a future "send-then-change"
  -- flow. It's harmless when null.
  apply_status_code text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz
);

CREATE INDEX IF NOT EXISTS email_outbox_queue_idx
  ON public.email_outbox (status, next_attempt_at)
  WHERE status IN ('queued', 'sending');
CREATE INDEX IF NOT EXISTS email_outbox_event_idx ON public.email_outbox (event_id);
CREATE INDEX IF NOT EXISTS email_outbox_app_idx ON public.email_outbox (application_id);
CREATE INDEX IF NOT EXISTS email_outbox_created_idx ON public.email_outbox (created_at DESC);

COMMENT ON TABLE public.email_outbox IS
  'Async email send queue. Worker claims batches via claim_email_batch().';

-- ---------------------------------------------------------------------------
-- claim_email_batch — atomic batch-claim for the worker.
--
-- Uses FOR UPDATE SKIP LOCKED so concurrent worker invocations never fight
-- over the same rows. Returns the claimed rows with status flipped to
-- 'sending' and attempts incremented; caller is responsible for marking them
-- 'sent' or back to 'queued' with a future next_attempt_at on failure.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_email_batch(p_limit integer DEFAULT 50)
RETURNS SETOF public.email_outbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.email_outbox
  SET status = 'sending',
      attempts = attempts + 1,
      updated_at = now()
  WHERE id IN (
    SELECT id
    FROM public.email_outbox
    WHERE status = 'queued'
      AND next_attempt_at <= now()
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

COMMENT ON FUNCTION public.claim_email_batch IS
  'Atomically claim and lock up to p_limit queued emails. Caller (worker) must mark each as sent/failed/queued-for-retry within the same transaction window or a reasonable time.';

-- ---------------------------------------------------------------------------
-- Recover stuck rows — if a worker crashed mid-send, rows may be stuck in
-- 'sending' forever. Safety net: any row in 'sending' older than 15 minutes
-- is reset to 'queued' so the next worker picks it up.
--
-- Called automatically at the start of each worker run.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recover_stuck_email_sends()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recovered AS (
    UPDATE public.email_outbox
    SET status = 'queued',
        updated_at = now(),
        last_error = COALESCE(last_error, '') || E'\n[recovered from stuck sending state]'
    WHERE status = 'sending'
      AND updated_at < now() - interval '15 minutes'
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM recovered;
$$;

-- ---------------------------------------------------------------------------
-- RLS — admins can see their org's outbox rows; service_role (used by the
-- Vercel worker with the SERVICE_ROLE key) bypasses RLS entirely.
-- ---------------------------------------------------------------------------
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins select outbox" ON public.email_outbox;
CREATE POLICY "admins select outbox" ON public.email_outbox
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE email = auth.jwt() ->> 'email'
        AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "admins insert outbox" ON public.email_outbox;
CREATE POLICY "admins insert outbox" ON public.email_outbox
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE email = auth.jwt() ->> 'email'
        AND role = 'admin'
    )
  );

-- Admins can cancel queued items (but not flip status to 'sent' etc.)
DROP POLICY IF EXISTS "admins cancel outbox" ON public.email_outbox;
CREATE POLICY "admins cancel outbox" ON public.email_outbox
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE email = auth.jwt() ->> 'email'
        AND role = 'admin'
    )
  )
  WITH CHECK (status = 'cancelled' AND attempts = 0);

-- updated_at trigger (reuse the pattern from other tables if one exists;
-- here we just inline it since nothing fancy is needed)
CREATE OR REPLACE FUNCTION public.email_outbox_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_outbox_updated_at ON public.email_outbox;
CREATE TRIGGER email_outbox_updated_at
  BEFORE UPDATE ON public.email_outbox
  FOR EACH ROW EXECUTE FUNCTION public.email_outbox_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Cron job setup — NOT applied automatically. Run this in the Supabase SQL
-- editor AFTER deploying the /api/process-email-queue endpoint:
--
-- 1. Enable extensions (one-time):
--      CREATE EXTENSION IF NOT EXISTS pg_cron;
--      CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- 2. Store the cron secret (must match EMAIL_QUEUE_CRON_SECRET in Vercel):
--      SELECT vault.create_secret('REPLACE_WITH_RANDOM_STRING', 'email_queue_cron_secret');
--
-- 3. Schedule the job (every minute):
--      SELECT cron.schedule(
--        'process-email-queue',
--        '* * * * *',
--        $$
--        SELECT net.http_post(
--          url := 'https://the-steps-foundation-intranet.vercel.app/api/process-email-queue',
--          headers := jsonb_build_object(
--            'Content-Type', 'application/json',
--            'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_cron_secret')
--          ),
--          body := '{}'::jsonb,
--          timeout_milliseconds := 30000
--        );
--        $$
--      );
--
-- 4. Inspect runs:    SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- 5. Unschedule:      SELECT cron.unschedule('process-email-queue');
-- ---------------------------------------------------------------------------
