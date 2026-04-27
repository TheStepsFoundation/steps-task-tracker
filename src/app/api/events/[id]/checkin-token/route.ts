import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createCheckinToken } from '@/lib/checkin-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/events/[id]/checkin-token
//
// Returns the QR token a student should display at the door for THIS event.
// Auth: must be the signed-in student whose application is being tokenised.
//
// We don't return tokens for any application that isn't the caller's own,
// and we only return one for status='accepted' — anything else (waitlisted,
// withdrew, rejected, submitted) means the student isn't actually expected
// at the door, so we shouldn't generate a scannable code.
//
// Why an API route and not building the token server-side in the page render:
//   - /my/events/[id]/page.tsx is a client component (it manages a lot of
//     local state — withdraw modals, edit drafts, form draft restoration).
//     Pulling crypto into a 'use client' file is a no-go.
//   - A short JSON endpoint is the minimum-blast-radius surface.
// ---------------------------------------------------------------------------

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const eventId = params.id
  if (!eventId) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 })
  }
  const accessToken = authHeader.slice('Bearer '.length).trim()
  if (!accessToken) return NextResponse.json({ error: 'Empty access token' }, { status: 401 })

  const svc = getServiceClient()
  const { data: userData, error: userErr } = await svc.auth.getUser(accessToken)
  if (userErr || !userData?.user?.email) {
    return NextResponse.json({ error: 'Invalid access token' }, { status: 401 })
  }
  const email = userData.user.email.toLowerCase()

  // Look up the student by personal_email — same field auth uses.
  const { data: student, error: stErr } = await svc
    .from('students')
    .select('id')
    .eq('personal_email', email)
    .maybeSingle()
  if (stErr) return NextResponse.json({ error: 'Student lookup failed' }, { status: 500 })
  if (!student) return NextResponse.json({ error: 'No matching student profile' }, { status: 404 })

  // Find their application for this event. Most-recent non-deleted.
  const { data: app, error: appErr } = await svc
    .from('applications')
    .select('id, status')
    .eq('student_id', (student as { id: string }).id)
    .eq('event_id', eventId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (appErr) return NextResponse.json({ error: 'Application lookup failed' }, { status: 500 })
  if (!app) return NextResponse.json({ error: 'No application for this event' }, { status: 404 })

  if ((app as any).status !== 'accepted') {
    return NextResponse.json({
      error: 'not_accepted',
      currentStatus: (app as any).status,
    }, { status: 403 })
  }

  const token = createCheckinToken((app as { id: string }).id)
  return NextResponse.json({ token, applicationId: (app as { id: string }).id })
}
