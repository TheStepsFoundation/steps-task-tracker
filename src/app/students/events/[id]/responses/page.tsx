'use client'

// ---------------------------------------------------------------------------
// Application Overview — admin page that aggregates everything applicants
// said on the event's form. Lives at /students/events/[id]/responses and is
// reachable from the "Application overview" button on the event detail page.
//
// Why this exists: partners (e.g. Man Group) want to know which divisions /
// topics applicants are most interested in so they can tailor speakers; the
// team wants demographic and attribution overviews per event without
// hand-rolling SQL each time. Everything renders from data already in
// `applications` + `events.form_config` — no new schema.
//
// All aggregators are tolerant of missing answers and degrade quietly. The
// status filter at the top decides which applications feed every block —
// flip "Submitted only" / "Accepted only" depending on whether you're
// shaping the speaker line-up or planning breakouts.
// ---------------------------------------------------------------------------

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  fetchEvent, type EventRow, type FormFieldConfig, type FormPage,
} from '@/lib/events-api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppStatus = 'submitted' | 'shortlisted' | 'accepted' | 'rejected' | 'withdrew'

type StudentLite = {
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  personal_email: string | null
  year_group: number | null
  school_type: string | null
  free_school_meals: boolean | null
  parental_income_band: string | null
  first_generation_uni: boolean | null
  schools: { name: string | null } | null
}

type AppRow = {
  id: string
  student_id: string
  status: AppStatus
  submitted_at: string | null
  attribution_source: string | null
  channel: string | null
  raw_response: Record<string, unknown> | null
  students: StudentLite | null
}

// ---------------------------------------------------------------------------
// Lookup labels (mirrors apply form copy)
// ---------------------------------------------------------------------------

const SCHOOL_TYPE_LABELS: Record<string, string> = {
  state: 'State non-selective',
  grammar: 'State selective / grammar',
  independent: 'Independent (fee-paying)',
  independent_bursary: 'Independent (90%+ bursary)',
}

const INCOME_LABELS: Record<string, string> = {
  under_20k: 'Under £20k',
  '20_40k': '£20k–£40k',
  under_40k: 'Under £40k',
  over_40k: 'Over £40k',
  prefer_na: 'Prefer not to say',
}

const FSM_RAW_LABELS: Record<string, string> = {
  yes: 'Currently eligible',
  previously: 'Previously eligible',
  no: 'Not eligible',
}

const ATTRIBUTION_LABELS: Record<string, string> = {
  email_invite: 'Email invite',
  school_teacher: 'School / teacher',
  previous_steps_event: 'Past Steps event',
  previous_steps_application: 'Past Steps application',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  friend_word_of_mouth: 'Friend / word of mouth',
  other: 'Other',
}

const STATUS_LABELS: Record<AppStatus, string> = {
  submitted: 'Submitted',
  shortlisted: 'Shortlisted',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrew: 'Withdrew',
}

const STATUS_COLORS: Record<AppStatus, string> = {
  submitted: 'bg-steps-blue-100 text-steps-blue-700 border-steps-blue-200 dark:bg-steps-blue-900/30 dark:text-steps-blue-300 dark:border-steps-blue-800',
  shortlisted: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  accepted: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  rejected: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  withdrew: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
}

const ALL_STATUSES: AppStatus[] = ['submitted', 'shortlisted', 'accepted', 'rejected', 'withdrew']
const DEFAULT_STATUSES: AppStatus[] = ['submitted', 'shortlisted', 'accepted']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(n: number, total: number): string {
  if (!total) return '—'
  return `${Math.round((n / total) * 100)}%`
}

function wordCount(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).filter(Boolean).length : 0
}

function csvCell(v: unknown): string {
  if (v == null) return ''
  let s: string
  if (typeof v === 'object') {
    try { s = JSON.stringify(v) } catch { s = '' }
  } else {
    s = String(v)
  }
  // RFC4180-ish: wrap in quotes and double internal quotes if needed
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\n')
  // Prepend BOM so Excel opens UTF-8 correctly
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Strip HTML tags from a label that came from the rich-text label editor. */
function stripHtml(s: string | undefined | null): string {
  if (!s) return ''
  return s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}

// Walk through the form_config and collect both single-page fields and
// multi-page fields into one ordered list, dropping section_heading / media
// (which carry no answer data).
function flattenFormFields(event: EventRow | null): FormFieldConfig[] {
  if (!event?.form_config) return []
  const cfg = event.form_config as { fields?: FormFieldConfig[]; pages?: FormPage[] }
  const out: FormFieldConfig[] = []
  if (Array.isArray(cfg.pages)) {
    for (const p of cfg.pages) {
      for (const f of (p.fields ?? [])) out.push(f)
    }
  }
  if (Array.isArray(cfg.fields)) {
    for (const f of cfg.fields) out.push(f)
  }
  return out.filter(f => f.type !== 'section_heading' && f.type !== 'media')
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ApplicationOverviewPage() {
  const params = useParams()
  const eventId = params?.id as string

  const [event, setEvent] = useState<EventRow | null>(null)
  const [apps, setApps] = useState<AppRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<Set<AppStatus>>(new Set(DEFAULT_STATUSES))
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const initialLoad = useRef(true)

  const loadAll = useCallback(async (opts?: { silent?: boolean }) => {
    if (!eventId) return
    if (!opts?.silent) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      // Event + applications in parallel
      const [evt, appsData] = await Promise.all([
        fetchEvent(eventId),
        (async () => {
          // Batch through 1000-row pages just like the main event admin
          const BATCH = 1000
          let from = 0
          let all: AppRow[] = []
          for (;;) {
            const { data, error } = await supabase
              .from('applications')
              .select(`
                id, student_id, status, submitted_at, attribution_source, channel, raw_response,
                students!inner(first_name, last_name, preferred_name, personal_email, year_group,
                  school_type, free_school_meals, parental_income_band, first_generation_uni,
                  schools(name))
              `)
              .eq('event_id', eventId)
              .is('deleted_at', null)
              .order('submitted_at', { ascending: false })
              .range(from, from + BATCH - 1)
            if (error) throw error
            const rows = (data ?? []) as unknown as AppRow[]
            all = all.concat(rows)
            if (rows.length < BATCH) break
            from += BATCH
          }
          return all
        })(),
      ])
      setEvent(evt)
      setApps(appsData)
      setLastRefreshedAt(new Date())
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load')
    } finally {
      setLoading(false)
      setRefreshing(false)
      initialLoad.current = false
    }
  }, [eventId])

  useEffect(() => { void loadAll() }, [loadAll])

  // Filtered set used by every aggregator
  const filtered = useMemo(
    () => apps.filter(a => statusFilter.has(a.status)),
    [apps, statusFilter],
  )

  const fields = useMemo(() => flattenFormFields(event), [event])

  const statusCounts = useMemo(() => {
    const counts = { submitted: 0, shortlisted: 0, accepted: 0, rejected: 0, withdrew: 0 } as Record<AppStatus, number>
    for (const a of apps) counts[a.status] = (counts[a.status] ?? 0) + 1
    return counts
  }, [apps])

  const toggleStatus = (s: AppStatus) => {
    setStatusFilter(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      // Don't allow zero — fall back to defaults
      if (next.size === 0) return new Set(DEFAULT_STATUSES)
      return next
    })
  }

  // CSV export — one row per applicant, columns = standard demographics + every
  // form_config field. Useful for partner orgs who want raw data in Sheets.
  const handleExport = () => {
    const header = [
      'application_id', 'submitted_at', 'status',
      'first_name', 'last_name', 'email', 'year_group', 'school_type',
      'free_school_meals', 'parental_income_band', 'first_generation_uni',
      'school_name', 'attribution',
      ...fields.map(f => stripHtml(f.label) || f.id),
    ]
    const rows: string[][] = [header]
    for (const a of filtered) {
      const s = a.students
      const cf = ((a.raw_response ?? {}) as { custom_fields?: Record<string, unknown> }).custom_fields ?? {}
      const row = [
        a.id,
        a.submitted_at ?? '',
        a.status,
        s?.first_name ?? '',
        s?.last_name ?? '',
        s?.personal_email ?? '',
        s?.year_group != null ? String(s.year_group) : '',
        s?.school_type ?? '',
        s?.free_school_meals == null ? '' : (s.free_school_meals ? 'yes' : 'no'),
        s?.parental_income_band ?? '',
        s?.first_generation_uni == null ? '' : (s.first_generation_uni ? 'first-gen' : 'parent-graduated'),
        s?.schools?.name ?? '',
        a.attribution_source ?? a.channel ?? '',
        ...fields.map(f => {
          const v = (cf as Record<string, unknown>)[f.id]
          if (v == null) return ''
          if (typeof v === 'string') return v
          try { return JSON.stringify(v) } catch { return '' }
        }),
      ]
      rows.push(row)
    }
    const slug = (event?.slug ?? eventId).replace(/[^a-z0-9-]/gi, '-')
    downloadCsv(`${slug}-applications-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div role="status" aria-live="polite" className="text-center">
          <div aria-hidden="true" className="animate-spin w-8 h-8 border-2 border-steps-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading responses…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-8">
        <div className="max-w-2xl mx-auto bg-white dark:bg-gray-900 rounded-2xl border border-red-200 dark:border-red-900 p-6">
          <h1 className="text-lg font-semibold text-red-700 dark:text-red-400">Couldn&apos;t load this event</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{error}</p>
          <button onClick={() => loadAll()} className="mt-4 px-4 py-2 text-sm font-medium bg-steps-blue-600 text-white rounded-xl">Try again</button>
        </div>
      </div>
    )
  }

  if (!event) return null

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
          <div>
            <Link href={`/students/events/${eventId}`} className="text-sm text-steps-blue-600 hover:text-steps-blue-700 dark:text-steps-blue-400">
              ← Back to event
            </Link>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 mt-1">
              Application overview
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{event.name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => loadAll({ silent: true })}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              title="Re-fetch applications"
            >
              <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-steps-blue-50 text-steps-blue-700 border border-steps-blue-200 hover:bg-steps-blue-100 dark:bg-steps-blue-900/20 dark:text-steps-blue-300 dark:border-steps-blue-800 dark:hover:bg-steps-blue-900/30 transition-colors"
              title="Download a CSV of every application matching the current filter"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
              Export CSV
            </button>
          </div>
        </div>

        {lastRefreshedAt && (
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-6">
            Updated {lastRefreshedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        )}

        {/* Status filter chips */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 mb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mr-2">Filter</span>
            {ALL_STATUSES.map(s => {
              const active = statusFilter.has(s)
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    active ? STATUS_COLORS[s] : 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-800/50 dark:text-gray-500 dark:border-gray-700'
                  }`}
                >
                  {STATUS_LABELS[s]}
                  <span className="opacity-70">{statusCounts[s] ?? 0}</span>
                </button>
              )
            })}
            <span className="ml-auto text-sm text-gray-700 dark:text-gray-300">
              <strong className="font-semibold">{filtered.length}</strong> of {apps.length} application{apps.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">No applications match the current filter.</p>
          </div>
        ) : (
          <>
            {/* Demographic standard fields */}
            <Section title="Applicants — at a glance">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CountAggregate
                  label="Year group"
                  values={filtered.map(a => a.students?.year_group)}
                  formatter={v => v === 14 ? 'Gap year' : `Year ${v}`}
                />
                <CountAggregate
                  label="School type"
                  values={filtered.map(a => a.students?.school_type)}
                  formatter={v => SCHOOL_TYPE_LABELS[v as string] ?? String(v)}
                />
                <CountAggregate
                  label="Free school meals"
                  values={filtered.map(a => {
                    const raw = ((a.raw_response ?? {}) as { free_school_meals_raw?: string }).free_school_meals_raw
                    if (raw && FSM_RAW_LABELS[raw]) return raw
                    const b = a.students?.free_school_meals
                    return b == null ? null : (b ? 'yes' : 'no')
                  })}
                  formatter={v => FSM_RAW_LABELS[v as string] ?? String(v)}
                />
                <CountAggregate
                  label="Household income"
                  values={filtered.map(a => a.students?.parental_income_band)}
                  formatter={v => INCOME_LABELS[v as string] ?? String(v)}
                />
                <CountAggregate
                  label="Parent went to university"
                  values={filtered.map(a => {
                    const v = a.students?.first_generation_uni
                    if (v == null) return null
                    return v ? 'no' : 'yes'  // first_gen=true means first-gen → "no parent went to uni"
                  })}
                  formatter={v => v === 'yes' ? 'Yes' : 'No'}
                />
                <CountAggregate
                  label="How they heard"
                  values={filtered.map(a => a.attribution_source ?? a.channel)}
                  formatter={v => ATTRIBUTION_LABELS[v as string] ?? String(v)}
                />
              </div>
            </Section>

            {/* Custom form questions */}
            {fields.length > 0 && (
              <Section title="Form responses">
                <div className="space-y-6">
                  {fields.map(f => (
                    <FieldAggregate key={f.id} field={f} apps={filtered} />
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Generic Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">{title}</h2>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        {children}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// CountAggregate — used for the demographic standard fields. Shows a sorted
// horizontal-bar list of value→count, with %.
// ---------------------------------------------------------------------------

function CountAggregate({
  label, values, formatter,
}: {
  label: string
  values: (string | number | null | undefined)[]
  formatter?: (v: string | number) => string
}) {
  const { counts, total } = useMemo(() => {
    const c = new Map<string | number, number>()
    let t = 0
    for (const v of values) {
      if (v == null || v === '') continue
      c.set(v, (c.get(v) ?? 0) + 1)
      t++
    }
    return { counts: c, total: t }
  }, [values])

  const sorted = useMemo(
    () => Array.from(counts.entries()).sort((a, b) => b[1] - a[1]),
    [counts],
  )

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">{label}</h3>
      {total === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">No answers yet</p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map(([v, n]) => (
            <BarRow key={String(v)} label={formatter ? formatter(v) : String(v)} value={n} max={Math.max(...sorted.map(s => s[1]))} total={total} />
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BarRow — one horizontal bar with value and percentage. Width is relative to
// the *max* count in the group rather than the total — that way the leading
// option always reaches the full width and other options are visibly
// proportional.
// ---------------------------------------------------------------------------

function BarRow({
  label, value, max, total, sublabel,
}: {
  label: string
  value: number
  max: number
  total: number
  sublabel?: string
}) {
  const widthPct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-gray-700 dark:text-gray-200 truncate" title={label}>{label}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
          {value} <span className="opacity-60">·</span> {pct(value, total)}{sublabel ? ` · ${sublabel}` : ''}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mt-1">
        <div className="h-full bg-steps-blue-500 rounded-full transition-all" style={{ width: `${widthPct}%` }} />
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// FieldAggregate — dispatches to the right viewer for each form_config field.
// ---------------------------------------------------------------------------

function FieldAggregate({ field, apps }: { field: FormFieldConfig; apps: AppRow[] }) {
  const answered = useMemo(() => {
    return apps.map(a => {
      const cf = ((a.raw_response ?? {}) as { custom_fields?: Record<string, unknown> }).custom_fields ?? {}
      return (cf as Record<string, unknown>)[field.id]
    }).filter(v => v !== undefined && v !== null && v !== '')
  }, [apps, field.id])

  const label = stripHtml(field.label) || field.id
  const description = stripHtml(field.description)
  const responseRate = `${answered.length} of ${apps.length} answered (${pct(answered.length, apps.length)})`

  const Wrap = ({ children }: { children: React.ReactNode }) => (
    <div className="border-b border-gray-100 dark:border-gray-800 pb-5 last:border-b-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</h3>
        <span className="text-[11px] text-gray-400 dark:text-gray-500 flex-shrink-0">{responseRate}</span>
      </div>
      {description && <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 -mt-1">{description}</p>}
      {answered.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">No answers yet</p>
      ) : children}
    </div>
  )

  switch (field.type) {
    case 'ranked_dropdown':
      return <Wrap><RankedAggregate field={field} answers={answered as Record<string, string>[]} /></Wrap>
    case 'dropdown':
    case 'radio':
    case 'yes_no':
      return <Wrap><SingleChoiceAggregate field={field} answers={answered as string[]} /></Wrap>
    case 'checkbox_list':
      return <Wrap><CheckboxAggregate field={field} answers={answered as string[][]} /></Wrap>
    case 'paired_dropdown':
      return <Wrap><PairedAggregate field={field} answers={answered as { primary: string; secondary: string }[][]} /></Wrap>
    case 'matrix':
      return <Wrap><MatrixAggregate field={field} answers={answered as Record<string, string>[]} /></Wrap>
    case 'scale':
    case 'number':
      return <Wrap><NumericAggregate field={field} answers={answered as (number | string)[]} /></Wrap>
    case 'textarea':
    case 'text':
      return <Wrap><TextAggregate field={field} answers={answered as string[]} /></Wrap>
    case 'email':
    case 'phone':
    case 'date':
    case 'url':
      return <Wrap><CompactListAggregate answers={answered.map(String)} /></Wrap>
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Per-field-type aggregators
// ---------------------------------------------------------------------------

function RankedAggregate({ field, answers }: { field: FormFieldConfig; answers: Record<string, string>[] }) {
  const ranks = field.config?.ranks ?? 3
  const optionLabel = (v: string) => field.options?.find(o => o.value === v)?.label ?? v
  const rankKeys = Array.from({ length: ranks }, (_, i) =>
    i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : `choice_${i + 1}`,
  )
  // Borda: first choice = ranks points, last choice = 1 point
  const points = new Map<string, number>()
  const perRank = new Map<string, number[]>()
  for (const a of answers) {
    rankKeys.forEach((key, i) => {
      const v = a?.[key]
      if (!v) return
      const w = ranks - i
      points.set(v, (points.get(v) ?? 0) + w)
      const arr = perRank.get(v) ?? Array(ranks).fill(0)
      arr[i] = (arr[i] ?? 0) + 1
      perRank.set(v, arr)
    })
  }

  // Make sure every option appears even if zero
  for (const o of field.options ?? []) {
    if (!points.has(o.value)) {
      points.set(o.value, 0)
      perRank.set(o.value, Array(ranks).fill(0))
    }
  }

  const sorted = Array.from(points.entries()).sort((a, b) => b[1] - a[1])
  const maxPts = Math.max(...sorted.map(s => s[1]), 1)

  return (
    <>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">
        Borda count: rank #1 = {ranks} pts, #{ranks} = 1 pt. Hover bars for the per-rank tally.
      </p>
      <ul className="space-y-2">
        {sorted.map(([v, pts]) => {
          const rankCounts = perRank.get(v) ?? []
          const tooltip = rankKeys
            .map((_, i) => `#${i + 1}: ${rankCounts[i] ?? 0}`)
            .join(' · ')
          return (
            <li key={v} title={tooltip}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-gray-700 dark:text-gray-200 truncate" title={optionLabel(v)}>{optionLabel(v)}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                  <strong className="text-gray-700 dark:text-gray-200 font-semibold">{pts}</strong> pts · {tooltip}
                </span>
              </div>
              <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mt-1 flex">
                {rankCounts.map((c, i) => {
                  const segPts = c * (ranks - i)
                  const w = (segPts / maxPts) * 100
                  if (segPts === 0) return null
                  // Static palette — Tailwind cannot detect template-string
                  // class names, so we materialise the shades upfront. Higher
                  // ranks get the darker shades.
                  const SHADES = ['bg-steps-blue-700', 'bg-steps-blue-500', 'bg-steps-blue-300', 'bg-steps-blue-200', 'bg-steps-blue-100']
                  const cls = SHADES[Math.min(i, SHADES.length - 1)]
                  return <div key={i} className={`h-full ${cls}`} style={{ width: `${w}%` }} />
                })}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function SingleChoiceAggregate({ field, answers }: { field: FormFieldConfig; answers: string[] }) {
  const optionLabel = (v: string) => field.options?.find(o => o.value === v)?.label ?? v
  const counts = new Map<string, number>()
  for (const a of answers) counts.set(a, (counts.get(a) ?? 0) + 1)
  for (const o of field.options ?? []) {
    if (!counts.has(o.value)) counts.set(o.value, 0)
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  const max = Math.max(...sorted.map(s => s[1]), 1)
  return (
    <ul className="space-y-1.5">
      {sorted.map(([v, n]) => (
        <BarRow key={v} label={optionLabel(v)} value={n} max={max} total={answers.length} />
      ))}
    </ul>
  )
}

function CheckboxAggregate({ field, answers }: { field: FormFieldConfig; answers: string[][] }) {
  const optionLabel = (v: string) => field.options?.find(o => o.value === v)?.label ?? v
  const counts = new Map<string, number>()
  for (const a of answers) {
    const arr = Array.isArray(a) ? a : []
    for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  for (const o of field.options ?? []) {
    if (!counts.has(o.value)) counts.set(o.value, 0)
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  const max = Math.max(...sorted.map(s => s[1]), 1)
  return (
    <>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">
        Multi-select — percentages don&apos;t sum to 100%.
      </p>
      <ul className="space-y-1.5">
        {sorted.map(([v, n]) => (
          <BarRow key={v} label={optionLabel(v)} value={n} max={max} total={answers.length} />
        ))}
      </ul>
    </>
  )
}

function PairedAggregate({ field, answers }: { field: FormFieldConfig; answers: { primary: string; secondary: string }[][] }) {
  const primaryLabel = (v: string) =>
    field.config?.primaryOptions?.find(o => o.value === v)?.label ?? v
  const secondaryLabel = (v: string) =>
    field.config?.secondaryOptions?.find(o => o.value === v)?.label ?? v
  const pairCounts = new Map<string, number>()
  let total = 0
  for (const rows of answers) {
    for (const r of (rows ?? [])) {
      if (!r?.primary || !r?.secondary) continue
      const k = `${r.primary}${r.secondary}`
      pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1)
      total++
    }
  }
  const sorted = Array.from(pairCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12)
  const max = Math.max(...sorted.map(s => s[1]), 1)
  return (
    <ul className="space-y-1.5">
      {sorted.map(([k, n]) => {
        const [p, s] = k.split('')
        return <BarRow key={k} label={`${primaryLabel(p)} → ${secondaryLabel(s)}`} value={n} max={max} total={total} />
      })}
    </ul>
  )
}

function MatrixAggregate({ field, answers }: { field: FormFieldConfig; answers: Record<string, string>[] }) {
  const rows = field.config?.matrixRows ?? []
  const cols = field.config?.matrixColumns ?? []
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left py-1.5 pr-3 text-gray-400 dark:text-gray-500 font-medium">Row \\ Column</th>
            {cols.map(c => (
              <th key={c.value} className="text-center px-2 py-1.5 text-gray-400 dark:text-gray-500 font-medium">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const counts = cols.map(c => answers.filter(a => a?.[r.value] === c.value).length)
            const rowMax = Math.max(...counts, 1)
            return (
              <tr key={r.value} className="border-t border-gray-100 dark:border-gray-800">
                <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-200">{r.label}</td>
                {counts.map((n, i) => (
                  <td key={i} className="text-center px-2 py-1.5 text-gray-700 dark:text-gray-200">
                    <span className={n === rowMax && n > 0 ? 'font-semibold text-steps-blue-700 dark:text-steps-blue-400' : ''}>{n}</span>
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function NumericAggregate({ field, answers }: { field: FormFieldConfig; answers: (number | string)[] }) {
  const nums = answers.map(v => Number(v)).filter(v => Number.isFinite(v))
  if (nums.length === 0) return <p className="text-xs text-gray-400 dark:text-gray-500 italic">No numeric answers</p>
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  const sorted = [...nums].sort((a, b) => a - b)
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)]
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  // For scale fields, render a histogram from scaleMin..scaleMax
  const isScale = field.type === 'scale'
  const sMin = isScale ? (field.config?.scaleMin ?? 1) : Math.floor(min)
  const sMax = isScale ? (field.config?.scaleMax ?? 5) : Math.ceil(max)
  const histo: { bucket: number; n: number }[] = []
  for (let v = sMin; v <= sMax; v++) {
    histo.push({ bucket: v, n: nums.filter(x => Math.round(x) === v).length })
  }
  const histoMax = Math.max(...histo.map(h => h.n), 1)
  return (
    <>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mb-3">
        <span>Mean: <strong className="text-gray-900 dark:text-gray-100 font-semibold">{mean.toFixed(2)}</strong></span>
        <span>Median: <strong className="text-gray-900 dark:text-gray-100 font-semibold">{median.toFixed(2)}</strong></span>
        <span>Min: <strong className="text-gray-900 dark:text-gray-100 font-semibold">{min}</strong></span>
        <span>Max: <strong className="text-gray-900 dark:text-gray-100 font-semibold">{max}</strong></span>
        <span>n: <strong className="text-gray-900 dark:text-gray-100 font-semibold">{nums.length}</strong></span>
      </div>
      <ul className="space-y-1">
        {histo.map(({ bucket, n }) => (
          <BarRow key={bucket} label={String(bucket)} value={n} max={histoMax} total={nums.length} />
        ))}
      </ul>
    </>
  )
}

function TextAggregate({ field: _field, answers }: { field: FormFieldConfig; answers: string[] }) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const wordCounts = answers.map(a => wordCount(a)).filter(n => n > 0)
  const meanWords = wordCounts.length ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length) : 0
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return answers
    return answers.filter(a => a.toLowerCase().includes(q))
  }, [answers, query])
  const visible = expanded ? filtered : filtered.slice(0, 5)
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Avg <strong className="text-gray-900 dark:text-gray-100 font-semibold">{meanWords}</strong> words
        </span>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search responses…"
          aria-label="Search responses"
          className="flex-1 min-w-[160px] px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-steps-blue-500 outline-none"
        />
      </div>
      <ul className="space-y-2">
        {visible.map((a, i) => (
          <li key={i} className="text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">
            {a}
          </li>
        ))}
      </ul>
      {filtered.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="mt-3 text-xs font-medium text-steps-blue-600 hover:text-steps-blue-700 dark:text-steps-blue-400"
        >
          {expanded ? 'Show fewer' : `Show all ${filtered.length}`}
        </button>
      )}
      {filtered.length === 0 && query && (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">No responses match &ldquo;{query}&rdquo;.</p>
      )}
    </>
  )
}

function CompactListAggregate({ answers }: { answers: string[] }) {
  return (
    <ul className="text-xs text-gray-700 dark:text-gray-200 space-y-1">
      {answers.slice(0, 30).map((a, i) => <li key={i} className="font-mono">{a}</li>)}
      {answers.length > 30 && <li className="text-gray-400 dark:text-gray-500">…and {answers.length - 30} more</li>}
    </ul>
  )
}
