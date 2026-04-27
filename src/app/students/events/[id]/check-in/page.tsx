'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Html5Qrcode } from 'html5-qrcode'
import { TopNav } from '@/components/TopNav'
import { supabase } from '@/lib/supabase'
import { fetchEvent, type EventRow } from '@/lib/events-api'

// ---------------------------------------------------------------------------
// Admin QR check-in scanner.
//
// Open this page on a phone at the door, point the camera at the student's
// QR code (rendered on /my/events/[id]), and the API will mark them attended.
// Three colour-coded outcomes:
//   green  : success (first scan)
//   amber  : already_checked_in (duplicate scan — distinct from success on
//            purpose, per Favour's request)
//   red    : invalid / wrong-event / not-accepted / not-found / network err
//
// Implementation notes:
//   - html5-qrcode owns the camera; we wire the success/error callbacks
//     into a small queue so two rapid frame decodes of the same QR don't
//     stack into two HTTP calls.
//   - After each scan we briefly pause and dim the viewport so the admin
//     has a moment to read the result before the next student steps up.
//     The camera doesn't stop entirely though — that re-acquires permission
//     on iOS Safari which is a 2-3s delay we don't want at the door.
//   - There's no client-side dedup store: relying on the server's idempotent
//     "attended_at already set => already_checked_in" path is the right
//     source of truth, since multiple admins might be scanning at once.
// ---------------------------------------------------------------------------

const SCAN_REGION_ID = 'checkin-scan-region'

type ScanOutcome =
  | { kind: 'success'; studentName: string; yearGroup: string | null; checkedInAt: string }
  | { kind: 'duplicate'; studentName: string; yearGroup: string | null; checkedInAt: string }
  | { kind: 'wrong_event'; studentName?: string | null; yearGroup?: string | null }
  | { kind: 'not_accepted'; currentStatus: string; studentName: string | null; yearGroup: string | null }
  | { kind: 'invalid'; reason: string }
  | { kind: 'not_found' }
  | { kind: 'network'; message: string }

type RecentScan = {
  at: string
  outcome: ScanOutcome
}

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Application submitted (no decision yet)',
  shortlisted: 'Shortlisted',
  waitlisted: 'Waitlisted',
  rejected: 'Rejected',
  withdrew: 'Withdrew',
  accepted: 'Accepted',
}

function describe(outcome: ScanOutcome): { tone: 'green' | 'amber' | 'red'; title: string; subtitle: string } {
  switch (outcome.kind) {
    case 'success':
      return {
        tone: 'green',
        title: `\u2713 Checked in: ${outcome.studentName}`,
        subtitle: `${outcome.yearGroup ?? 'Year group unknown'} \u00b7 ${new Date(outcome.checkedInAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
      }
    case 'duplicate':
      return {
        tone: 'amber',
        title: `Already checked in: ${outcome.studentName}`,
        subtitle: `Originally scanned at ${new Date(outcome.checkedInAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
      }
    case 'wrong_event':
      return {
        tone: 'red',
        title: 'QR is for a different event',
        subtitle: outcome.studentName ? `${outcome.studentName} \u2014 send them to the correct event\u2019s door.` : 'Send the student to the correct event\u2019s door.',
      }
    case 'not_accepted':
      return {
        tone: 'red',
        title: outcome.studentName ? `Not accepted: ${outcome.studentName}` : 'Not accepted',
        subtitle: `Status is "${STATUS_LABELS[outcome.currentStatus] ?? outcome.currentStatus}". Handle manually before checking in.`,
      }
    case 'invalid':
      return { tone: 'red', title: 'Invalid QR code', subtitle: outcome.reason }
    case 'not_found':
      return { tone: 'red', title: 'No matching application', subtitle: 'The QR is signed correctly but the application no longer exists.' }
    case 'network':
      return { tone: 'red', title: 'Couldn\u2019t reach the server', subtitle: outcome.message }
  }
}

const TONE_CLASSES: Record<'green' | 'amber' | 'red', string> = {
  green: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  amber: 'border-amber-300 bg-amber-50 text-amber-900',
  red: 'border-rose-300 bg-rose-50 text-rose-900',
}

export default function EventCheckinScannerPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const eventId = params?.id as string

  const [event, setEvent] = useState<EventRow | null>(null)
  const [eventErr, setEventErr] = useState<string | null>(null)
  const [permission, setPermission] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle')
  const [permissionErr, setPermissionErr] = useState<string | null>(null)
  const [latest, setLatest] = useState<RecentScan | null>(null)
  const [recent, setRecent] = useState<RecentScan[]>([])
  const [paused, setPaused] = useState(false)

  const scannerRef = useRef<Html5Qrcode | null>(null)
  // Token of the most recent successful (or duplicate) scan; used to debounce
  // rapid re-decodes of the same QR. Cleared after RESCAN_DEBOUNCE_MS.
  const lastTokenRef = useRef<{ token: string; at: number } | null>(null)
  const inFlightRef = useRef<boolean>(false)

  const RESCAN_DEBOUNCE_MS = 2500
  const PAUSE_AFTER_SCAN_MS = 1200

  // Load event metadata (header banner + name).
  useEffect(() => {
    if (!eventId) return
    let cancelled = false
    fetchEvent(eventId)
      .then(ev => { if (!cancelled) setEvent(ev) })
      .catch(err => { if (!cancelled) setEventErr(err?.message ?? 'Failed to load event') })
    return () => { cancelled = true }
  }, [eventId])

  const handleScan = useCallback(async (decodedText: string) => {
    if (!eventId) return
    // Debounce rapid duplicate frames of the same QR.
    const now = Date.now()
    const last = lastTokenRef.current
    if (last && last.token === decodedText && now - last.at < RESCAN_DEBOUNCE_MS) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    lastTokenRef.current = { token: decodedText, at: now }
    setPaused(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const accessToken = session?.access_token
      if (!accessToken) {
        const outcome: ScanOutcome = { kind: 'network', message: 'Your session has expired \u2014 sign in again.' }
        const scan = { at: new Date().toISOString(), outcome }
        setLatest(scan); setRecent(p => [scan, ...p].slice(0, 12))
        return
      }
      const res = await fetch(`/api/events/${eventId}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ token: decodedText }),
      })
      let payload: any
      try { payload = await res.json() } catch { payload = null }
      if (!res.ok) {
        const outcome: ScanOutcome = { kind: 'network', message: payload?.error ?? `HTTP ${res.status}` }
        const scan = { at: new Date().toISOString(), outcome }
        setLatest(scan); setRecent(p => [scan, ...p].slice(0, 12))
        return
      }

      let outcome: ScanOutcome
      switch (payload.result) {
        case 'success':
          outcome = { kind: 'success', studentName: payload.studentName, yearGroup: payload.yearGroup ?? null, checkedInAt: payload.checkedInAt }
          // Light haptic feedback if supported.
          try { (navigator as any).vibrate?.(80) } catch {}
          break
        case 'already_checked_in':
          outcome = { kind: 'duplicate', studentName: payload.studentName, yearGroup: payload.yearGroup ?? null, checkedInAt: payload.checkedInAt }
          try { (navigator as any).vibrate?.([60, 40, 60]) } catch {}
          break
        case 'wrong_event':
          outcome = { kind: 'wrong_event' }
          break
        case 'not_accepted':
          outcome = { kind: 'not_accepted', currentStatus: payload.currentStatus, studentName: payload.studentName ?? null, yearGroup: payload.yearGroup ?? null }
          break
        case 'invalid_token':
          outcome = { kind: 'invalid', reason: payload.reason ?? 'Token failed signature check' }
          break
        case 'not_found':
          outcome = { kind: 'not_found' }
          break
        default:
          outcome = { kind: 'network', message: `Unexpected result: ${payload?.result ?? '(none)'}` }
      }
      const scan = { at: new Date().toISOString(), outcome }
      setLatest(scan); setRecent(p => [scan, ...p].slice(0, 12))
    } catch (e: any) {
      const outcome: ScanOutcome = { kind: 'network', message: e?.message ?? 'Network error' }
      const scan = { at: new Date().toISOString(), outcome }
      setLatest(scan); setRecent(p => [scan, ...p].slice(0, 12))
    } finally {
      inFlightRef.current = false
      window.setTimeout(() => setPaused(false), PAUSE_AFTER_SCAN_MS)
    }
  }, [eventId])

  const startCamera = useCallback(async () => {
    if (scannerRef.current) return
    setPermission('requesting')
    setPermissionErr(null)
    try {
      const scanner = new Html5Qrcode(SCAN_REGION_ID)
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => { void handleScan(decodedText) },
        () => { /* per-frame decode failures are noisy; ignore */ },
      )
      setPermission('granted')
    } catch (err: any) {
      setPermissionErr(err?.message ?? 'Camera permission denied')
      setPermission('denied')
      scannerRef.current = null
    }
  }, [handleScan])

  // Stop the camera on unmount.
  useEffect(() => {
    return () => {
      const s = scannerRef.current
      if (s) {
        s.stop().catch(() => {}).finally(() => { try { s.clear() } catch {} })
        scannerRef.current = null
      }
    }
  }, [])

  if (eventErr) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6">
        <p className="text-rose-600">{eventErr}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <TopNav variant="dark" homeHref="/students/events">
        <button
          onClick={() => router.push(`/students/events/${eventId}`)}
          className="px-3 py-1.5 text-sm text-slate-200 hover:text-white border border-slate-700 rounded-lg hover:bg-slate-800 transition"
        >
          Close scanner
        </button>
      </TopNav>

      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-semibold">Door check-in</h1>
          {event && <span className="text-slate-400 text-sm">\u00b7 {event.name}</span>}
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Scan students\u2019 QR codes from their <Link href="/my" className="underline hover:text-white">/my/events</Link> page. The scanner only marks accepted students; everything else gets flagged.
        </p>

        {/* Camera surface */}
        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden relative">
          <div id={SCAN_REGION_ID} className={`w-full aspect-square sm:aspect-video transition ${paused ? 'opacity-50' : 'opacity-100'}`} />
          {permission !== 'granted' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-slate-900/95">
              <p className="text-slate-200 font-semibold">Camera access needed</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">
                We use your phone\u2019s camera to read student QR codes. Nothing is uploaded \u2014 each scan is decoded locally.
              </p>
              <button
                type="button"
                onClick={() => { void startCamera() }}
                className="mt-4 px-4 py-2 rounded-xl bg-emerald-500 text-emerald-950 font-semibold hover:bg-emerald-400 transition"
              >
                {permission === 'requesting' ? 'Requesting\u2026' : 'Turn camera on'}
              </button>
              {permissionErr && <p className="text-xs text-rose-400 mt-3 max-w-xs">{permissionErr}</p>}
            </div>
          )}
        </div>

        {/* Latest scan banner */}
        {latest && (() => {
          const d = describe(latest.outcome)
          return (
            <div className={`mt-5 border rounded-2xl px-4 py-3 ${TONE_CLASSES[d.tone]}`}>
              <p className="font-semibold">{d.title}</p>
              <p className="text-sm opacity-80">{d.subtitle}</p>
            </div>
          )
        })()}

        {/* Recent scans log */}
        {recent.length > 1 && (
          <div className="mt-6">
            <h2 className="text-xs uppercase tracking-wide text-slate-400 font-medium">Recent scans</h2>
            <ul className="mt-2 divide-y divide-slate-800 border border-slate-800 rounded-2xl bg-slate-900">
              {recent.slice(1).map((r, i) => {
                const d = describe(r.outcome)
                const dot = d.tone === 'green' ? 'bg-emerald-400' : d.tone === 'amber' ? 'bg-amber-400' : 'bg-rose-400'
                return (
                  <li key={r.at + ':' + i} className="px-3 py-2 flex items-center gap-3 text-sm">
                    <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
                    <span className="text-slate-200 flex-1 truncate">{d.title}</span>
                    <span className="text-xs text-slate-500 shrink-0">{new Date(r.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <p className="mt-8 text-xs text-slate-500">
          Need to mark someone manually? Open the <Link href={`/students/events/${eventId}`} className="underline hover:text-slate-300">candidate list</Link> and use the per-row attendance toggle.
        </p>
      </div>
    </div>
  )
}
