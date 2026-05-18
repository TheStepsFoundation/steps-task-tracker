import crypto from 'crypto'

/**
 * Stateless one-click withdraw tokens.
 *
 * Token format: `<base64url(applicationId)>.<hmac-sig>`
 *   - HMAC-SHA256(applicationId, secret), base64url-encoded
 *   - No timestamp / no expiry. Soft-deleted rows are skipped by the
 *     handler anyway, so a stale token is naturally inert once the
 *     application is already withdrawn. Worst case: a leaked token lets
 *     someone withdraw a *live* application, which the recipient can undo
 *     by re-applying (with their previous answers pre-filled).
 *
 * Why HMAC and not a DB table:
 *   - One token per recipient per send, generated server-side at send time.
 *   - Verify in O(1) without a DB round-trip before the GET renders the
 *     confirmation page (the confirm page wants to feel instant).
 *
 * Mirrors lib/unsubscribe-token.ts and lib/checkin-token.ts on purpose. If
 * you change one signature, update the others.
 */

const SECRET_ENV = 'WITHDRAW_SECRET'

function getSecret(): string {
  // Primary: dedicated secret (set in Vercel: WITHDRAW_SECRET).
  const s = process.env[SECRET_ENV]
  if (s && s.length >= 16) return s
  // Fallback: derive from the service role key so the feature works on
  // deploys that haven't configured WITHDRAW_SECRET yet. Acceptable for
  // launch — rotating the service key would invalidate every live withdraw
  // link, which is a destructive event for the platform anyway.
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (fallback) {
    console.warn(`[withdraw-token] ${SECRET_ENV} not set — falling back to SUPABASE_SERVICE_ROLE_KEY. Set a dedicated secret in Vercel for stable links across key rotations.`)
    return fallback
  }
  throw new Error(`${SECRET_ENV} or SUPABASE_SERVICE_ROLE_KEY must be set`)
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function sign(payload: string): string {
  return base64url(crypto.createHmac('sha256', getSecret()).update(payload).digest())
}

export function createWithdrawToken(applicationId: string): string {
  const payload = base64url(Buffer.from(applicationId, 'utf8'))
  const sig = sign(payload)
  return `${payload}.${sig}`
}

export function verifyWithdrawToken(token: string | null | undefined):
  | { ok: true; applicationId: string }
  | { ok: false; reason: string } {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing token' }
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed token' }
  const [payload, sig] = parts
  let expected: string
  try { expected = sign(payload) } catch (e: any) { return { ok: false, reason: e?.message ?? 'secret error' } }
  // Constant-time compare to avoid timing attacks. Uint8Array avoids
  // a TS mismatch in Node 20's Buffer typings under strict mode.
  const a = new Uint8Array(Buffer.from(sig))
  const b = new Uint8Array(Buffer.from(expected))
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad signature' }
  const applicationId = base64urlDecode(payload).toString('utf8')
  // Minimal sanity — applicationId looks like a UUID
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(applicationId)) {
    return { ok: false, reason: 'payload not a UUID' }
  }
  return { ok: true, applicationId }
}

/**
 * Build the absolute URL a recipient can click to withdraw their application
 * to a specific event. The origin is read from NEXT_PUBLIC_SITE_URL (set in
 * Vercel) so preview deployments don't leak prod tokens into prod rows by
 * accident; falls back to the canonical prod URL for local dev convenience.
 */
export function buildWithdrawUrl(applicationId: string): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://the-steps-foundation-intranet.vercel.app'
  const token = createWithdrawToken(applicationId)
  return `${origin.replace(/\/$/, '')}/api/withdraw?token=${encodeURIComponent(token)}`
}

/**
 * The literal merge tag we leave in stored email_outbox bodies. The queue
 * worker substitutes this with the real per-recipient signed URL at send
 * time, so the admin can sprinkle it through the body without the client
 * ever needing the WITHDRAW_SECRET.
 *
 * The exported regex matches the tag globally so callers can use String#replace.
 */
export const WITHDRAW_LINK_TAG = '{{withdraw_link}}'
export const WITHDRAW_LINK_TAG_REGEX = /\{\{withdraw_link\}\}/g
