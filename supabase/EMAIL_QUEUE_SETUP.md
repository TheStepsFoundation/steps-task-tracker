# Email Queue Worker — Setup Guide

The event admin compose modal enqueues emails into `email_outbox` (see migration
`0014_email_outbox.sql`) instead of sending them inline. A scheduled worker
drains the queue by calling `POST /api/process-email-queue` every minute, which
claims up to 50 rows per run, sends via Gmail, and logs the outcome to
`email_log`.

End-to-end throughput: ~50 emails / minute, i.e. ~800 in 16 min — matching the
old Mailmerge cadence. Admins can close the tab; sends continue.

---

## One-time setup

### 1. Generate a cron secret

Any random high-entropy string. This is the shared secret the Supabase cron
job uses to authenticate with the Vercel endpoint.

```bash
# Example: openssl rand -hex 32
# → put the output somewhere safe; you'll paste it into Vercel AND Supabase vault
```

### 2. Add Vercel environment variables

In the Vercel dashboard → the-steps-foundation-intranet → Settings →
Environment Variables, add (Production + Preview):

| Name | Value |
|------|-------|
| `EMAIL_QUEUE_CRON_SECRET` | the random string from step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase dashboard → Settings → API → service_role (keep secret) |
| `GMAIL_CLIENT_ID` | already present (used by existing send endpoint) |
| `GMAIL_CLIENT_SECRET` | already present |
| `GMAIL_REFRESH_TOKEN` | already present |

Redeploy so the new vars are picked up.

### 3. Enable Supabase extensions

In Supabase dashboard → Database → Extensions, enable:

- `pg_cron` — schedules the worker
- `pg_net` — lets the scheduled job make HTTP requests

Or via SQL:

```sql
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
```

### 4. Store the cron secret in Supabase vault

```sql
-- Paste the SAME value you added to Vercel as EMAIL_QUEUE_CRON_SECRET
select vault.create_secret(
  'PASTE_YOUR_CRON_SECRET_HERE',
  'email_queue_cron_secret',
  'Shared secret for /api/process-email-queue'
);
```

If the secret ever needs rotating, use `vault.update_secret(id, 'new_value')`
and re-deploy Vercel with the new value.

### 5. Schedule the worker

```sql
select cron.schedule(
  'process-email-queue',
  '* * * * *',  -- every minute
  $$
  select net.http_post(
    url := 'https://the-steps-foundation-intranet.vercel.app/api/process-email-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
```

---

## Verifying it works

### Manual smoke test

From your machine:

```bash
curl -X POST https://the-steps-foundation-intranet.vercel.app/api/process-email-queue \
  -H "x-cron-secret: YOUR_SECRET" \
  -H "Content-Type: application/json"
```

Expected JSON response:

```json
{ "claimed": 0, "sent": 0, "failed": 0, "retried": 0, "durationMs": 123 }
```

GET on the same URL (with the header) returns current tallies by status —
useful for health checks.

### Check scheduled runs

```sql
-- Recent cron invocations
select * from cron.job_run_details
where jobname = 'process-email-queue'
order by start_time desc
limit 10;

-- Current queue state
select status, count(*) from email_outbox group by status;
```

---

## Operating

- **Pausing the queue:** `select cron.unschedule('process-email-queue');`
- **Resuming:** re-run step 5 above.
- **Retries:** transient failures (429, 5xx, timeout) are retried with
  quadratic backoff up to `max_attempts` (default 5). Permanent failures are
  marked `status = 'failed'` and logged to `email_log` with status `'failed'`.
- **Stuck rows:** if a worker crashes mid-batch, rows can be stuck in
  `status = 'sending'`. `recover_stuck_email_sends()` (called at the start of
  every worker run) resets anything stuck >15 min back to `queued`.
- **Cancelling pending sends:** set `status = 'cancelled'` on any queued row
  before the worker claims it.

---

## Architecture

```
Admin clicks "Accept & Notify" (e.g. 800 applicants)
  │
  ▼
sendEmails() bulk-inserts 800 rows into email_outbox (status='queued')
  │
  │  returns in <1s — admin can close tab
  ▼
pg_cron fires every minute
  │
  ▼
net.http_post → /api/process-email-queue
  │
  ├── claim_email_batch(50)  ← FOR UPDATE SKIP LOCKED — safe under concurrent runs
  │     status: queued → sending
  │
  ├── for each row:
  │     gmail.users.messages.send
  │     ├── success → email_outbox.status='sent' + insert email_log
  │     ├── transient fail → status='queued', next_attempt_at = now + backoff
  │     └── permanent fail → status='failed' + log as 'failed'
  │
  └── returns { claimed, sent, failed, retried }
```

Worst case: if the cron job fails to invoke the endpoint (network issue,
Vercel down), rows sit in `queued` until the next run picks them up — no data
loss.
