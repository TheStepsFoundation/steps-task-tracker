import crypto from 'crypto'

/**
 * Stateless event check-in tokens.
 *
 * Token format: `<base64url(applicationId)>.<hmac-sig>`
 *   - HMAC-SHA256(applicationId, secret), base64url-encoded
 *   - No timestamp / no expiry. Tokens are encoded into a QR shown only on
 *     the student's authenticated /my/events/[id] page; they're not emailed
 *     or printed, so leakage is limited and rotating the secret on suspicion
 *     of compromise is straightforward.
 *
 * Why HMAC and not a DB table:
 *   - One QR per student per event, regenerated cheaply on every page render.
 *   - Verify in O(1) on the scanner side (the door is the latency-sensitive
 *     surface — admin doesn't want to wait for a DB roundtrip per scan).
 *   - The duplicate-scan check is the *only* read we need, and that's keyed
 *     directly on applications.id which we recover from the token payload.
 *
 * Mirrors lib/unsubscribe-token.ts on purpose. If you change one signature,
 * update the other.
 */

const SECRET_ENV = 'CHECKIN_SECRET'

function getSecret(): string {
  // Primary: dedicated secret (set in Vercel: CHECKIN_SECRET).
  const s = process.env[SECRET_ENV]
  if (s && s.length >= 16) return s
  // Fallback: derive from the service role key so the feature works on
  // deploys that haven't configured CHECKIN_SECRET yet. Acceptable for
  // launch — rotating the service key would invalidate every live token,
  // but that's also a destructive thing for the platform overall, so this
  // is a "you'll know if it happens" situation.
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (fallback) {
    console.warn(`[checkin-token] ${SECRET_ENV} not set — falling back to SUPABASE_SERVICE_ROLE_KEY. Set a dedicated secret for stable QR tokens across key rotations.`)
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

export function createCheckinToken(applicationId: string): string {
  const payload = base64url(Buffer.from(applicationId, 'utf8'))
  const sig = sign(payload)
  return `${payload}.${sig}`
}

export function verifyCheckinToken(token: string | null | undefined):
  | { ok: true; applicationId: string }
  | { ok: false; reason: string } {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing token' }
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed token' }
  const [payload, sig] = parts
  let expected: string
  try { expected = sign(payload) } catch (e: any) { return { ok: false, reason: e?.message ?? 'secret error' } }
  // Constant-time compare to avoid timing attacks.
  const a = new Uint8Array(Buffer.from(sig))
  const b = new Uint8Array(Buffer.from(expected))
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad signature' }
  const applicationId = base64urlDecode(payload).toString('utf8')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(applicationId)) {
    return { ok: false, reason: 'payload not a UUID' }
  }
  return { ok: true, applicationId }
}
