import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Server-side client using the anon key — search_schools is SECURITY DEFINER
// and GRANTed to anon/authenticated, so this is safe and avoids leaking
// the service-role key.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Rate limit: this is the only unauthed API route in the project, so it's
// the one with realistic abuse potential (scrape-every-school loops, noisy
// neighbour driving up Supabase row reads). The cap is per-IP, sliding
// window, in-memory.
//
// Caveats:
//   * In-memory means the counter is per Vercel function instance — a
//     determined attacker can hit multiple instances. For real distributed
//     abuse we'd want Upstash Ratelimit or similar; this layer is here to
//     stop casual abuse and accidental loops in client code.
//   * The Vercel platform layer (DDoS protection, regional rate limits)
//     sits in front of this and absorbs anything pathological.
//
// Rule: 60 requests per minute per IP. The school picker fires roughly one
// request per keystroke (debounced upstream), so 60/min is generous for a
// real applicant typing their school name and tight enough to flag a bot.
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 60

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

function clientIp(req: NextRequest): string {
  // Vercel forwards the original client IP via x-forwarded-for; first hop is
  // the user. Fall back to a constant key so the limiter still throttles
  // even if the header is missing — better to over-throttle than to give up.
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

function checkRate(ip: string): { ok: true; remaining: number } | { ok: false; retryAfter: number } {
  const now = Date.now()
  const bucket = buckets.get(ip)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return { ok: true, remaining: RATE_MAX - 1 }
  }
  if (bucket.count >= RATE_MAX) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) }
  }
  bucket.count += 1
  return { ok: true, remaining: RATE_MAX - bucket.count }
}

// Opportunistic prune so the Map doesn't grow unbounded on long-lived
// instances. Cheap walk; we only pay it when something is being requested
// anyway and the cost is trivial relative to a Supabase RPC round trip.
function pruneStaleBuckets() {
  const now = Date.now()
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k)
  }
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req)
  const rate = checkRate(ip)
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rate.retryAfter),
          'X-RateLimit-Limit': String(RATE_MAX),
          'X-RateLimit-Remaining': '0',
        },
      },
    )
  }
  if (buckets.size > 1000) pruneStaleBuckets()

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  const limRaw = Number(req.nextUrl.searchParams.get('limit') ?? '15')
  const lim = Number.isFinite(limRaw) ? Math.min(50, Math.max(1, Math.floor(limRaw))) : 15

  if (!q) {
    return NextResponse.json(
      { results: [] },
      { headers: { 'X-RateLimit-Limit': String(RATE_MAX), 'X-RateLimit-Remaining': String(rate.remaining) } },
    )
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  })
  const { data, error } = await client.rpc('search_schools', { q, lim })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(
    { results: data ?? [] },
    { headers: { 'X-RateLimit-Limit': String(RATE_MAX), 'X-RateLimit-Remaining': String(rate.remaining) } },
  )
}
