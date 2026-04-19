-- Allow unauthenticated (anon) users to read non-deleted events.
-- Needed so the /apply/[slug] page can fetch form_config before OTP auth.
CREATE POLICY events_public_read ON public.events
  FOR SELECT
  TO anon
  USING (deleted_at IS NULL);
