-- ---------------------------------------------------------------------------
-- 0022_email_outbox_attachments.sql
--
-- Adds a per-row attachments list to email_outbox so the queue worker can
-- fetch + attach files at send time. Shape per element:
--   { url: string, filename: string, mime_type: string, size_bytes: number }
--
-- Applied to production via MCP on 2026-04-22.
-- ---------------------------------------------------------------------------

ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.email_outbox.attachments IS
  'Array of {url, filename, mime_type, size_bytes}. Fetched and attached at send time.';
