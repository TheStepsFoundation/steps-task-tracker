import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyCheckinToken } from '@/lib/checkin-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/events/[id]/check-in
//
// Admin scanner endpoint. Body: { token: "<base64url>.<sig>" }.
//
// The token is an HMAC-signed application_id (see lib/checkin-token.ts). The
// scanner page reads it off the camera, POSTs here, and the server:
//   1. Gates the request — only authenticated team_members can mark
//      attendance. Anyone else gets 403 (not 401 — auth header was valid,
//      they're just not staff).
//   2. Verifies the token signature.
//   3. Looks up the application by id.
//   4. Cross-checks the event_id in the URL against the application's
//      event_id. A QR for event A scanned at event B's scanner is rejected
//      so admins can't accidentally check students in to the wrong event.
//   5. Cross-checks status === 'accepted'. Walk-ins, waitlisted, withdrew,
//      rejected, deleted, submitted-but-undecided all bounce so the door
//      conversation can resolve them manually.
//   6. Detects already-attended (the user explicitly asked for a distinct
//      duplicate-scan error). Returns the original attended_at so the
//      scanner can show "checked in 12 min ago".
//   7. Otherwise sets attended=true; the BEFORE UPDATE trigger added in
//      migration 0027 stamps attended_at to now().
//
// Result codes (all returned with HTTP 200 unless there's a server-side
// error — the scanner UI is the right place to render outcomes, and 4xx
// would noise up logs every time a student-not-accepted scan happens):
//   - success            : first scan, student now attended
//   - already_checked_in : second+ scan, student was already attended
//   - invalid_token      : token signature doesn't verify
//   - not_found          : token is well-formed but no application row
//   - wrong_event        : application belongs to a different event
//   - not_accepted       : application status isn't 'accepted'
//   - withdrew | rejected | submitted etc. — included in `currentStatus`
//
// HTTP status codes:
//   - 401: missing / bad bearer token
//   - 403: bearer token is fine but caller isn't a team_member
//   - 400: malformed body
//   - 500: server error talking to the DB
// ---------------------------------------------------------------------------

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function requireTeamMember(req: NextRequest): Promise<{ email: string } | { error: string; status: number }> {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing Authorization header', status: 401 }
  }
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) return { error: 'Empty access token', status: 401 }

  const svc = getServiceClient()
  const { data: userData, error: userErr } = await svc.auth.getUser(token)
  if (userErr || !userData?.user?.email) {
    return { error: 'Invalid access token', status: 401 }
  }
  const email = userData.user.email.toLowerCase()
  const { data: tm, error: tmErr } = await svc
    .from('team_members')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (tmErr) return { error: 'Membership lookup failed', status: 500 }
  if (!tm) return { error: 'Not authorised', status: 403 }
  return { email }
}

type CheckinResult =
  | { result: 'success'; applicationId: string; studentId: string; studentName: string; yearGroup: string | null; checkedInAt: string }
  | { result: 'already_checked_in'; applicationId: string; studentId: string; studentName: string; yearGroup: string | null; checkedInAt: string }
  | { result: 'invalid_token'; reason: string }
  | { result: 'not_found' }
  | { result: 'wrong_event'; expectedEventId: string; actualEventId: string }
  | { result: 'not_accepted'; currentStatus: string; studentName: string | null; yearGroup: string | null }

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const eventId = params.id
  if (!eventId) {
    return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
  }

  const gate = await requireTeamMember(req)
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const rawToken = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!rawToken) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 })
  }

  const verified = verifyCheckinToken(rawToken)
  if (!verified.ok) {
    const payload: CheckinResult = { result: 'invalid_token', reason: verified.reason }
    return NextResponse.json(payload, { status: 200 })
  }
  const applicationId = verified.applicationId

  const svc = getServiceClient()

  // Fetch the application + the student row in one round-trip via PostgREST's
  // implicit join syntax. soft-deleted apps don't count.
  const { data: app, error: appErr } = await svc
    .from('applications')
    .select(`
      id,
      event_id,
      student_id,
      status,
      attended,
      attended_at,
      students:student_id ( first_name, last_name, year_group )
    `)
    .eq('id', applicationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (appErr) {
    console.error('[checkin] application lookup failed', appErr)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
  if (!app) {
    const payload: CheckinResult = { result: 'not_found' }
    return NextResponse.json(payload, { status: 200 })
  }

  // Supabase sometimes returns the joined row as an array if the FK isn't
  // declared with a maybe-one constraint — normalise both shapes.
  const studentRow = Array.isArray((app as any).students)
    ? ((app as any).students[0] ?? null)
    : ((app as any).students ?? null)
  const studentName = studentRow
    ? `${studentRow.first_name ?? ''} ${studentRow.last_name ?? ''}`.trim() || null
    : null
  const yearGroup = studentRow?.year_group ?? null

  if ((app as any).event_id !== eventId) {
    const payload: CheckinResult = {
      result: 'wrong_event',
      expectedEventId: eventId,
      actualEventId: (app as any).event_id,
    }
    return NextResponse.json(payload, { status: 200 })
  }

  if ((app as any).status !== 'accepted') {
    const payload: CheckinResult = {
      result: 'not_accepted',
      currentStatus: (app as any).status,
      studentName,
      yearGroup,
    }
    return NextResponse.json(payload, { status: 200 })
  }

  // Duplicate scan: already attended.
  if ((app as any).attended === true) {
    const payload: CheckinResult = {
      result: 'already_checked_in',
      applicationId,
      studentId: (app as any).student_id,
      studentName: studentName ?? '(unknown)',
      yearGroup,
      checkedInAt: (app as any).attended_at ?? new Date().toISOString(),
    }
    return NextResponse.json(payload, { status: 200 })
  }

  // First scan: flip attended → true. Trigger stamps attended_at.
  const { data: updated, error: updErr } = await svc
    .from('applications')
    .update({ attended: true, updated_at: new Date().toISOString() } as any)
    .eq('id', applicationId)
    .select('id, attended_at')
    .single()

  if (updErr) {
    console.error('[checkin] update failed', updErr)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  const payload: CheckinResult = {
    result: 'success',
    applicationId,
    studentId: (app as any).student_id,
    studentName: studentName ?? '(unknown)',
    yearGroup,
    checkedInAt: (updated as any).attended_at ?? new Date().toISOString(),
  }
  return NextResponse.json(payload, { status: 200 })
}
