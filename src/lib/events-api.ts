import { supabase } from './supabase'

// =============================================================================
// Types
// =============================================================================

export type EventRow = {
  id: string
  name: string
  slug: string
  event_date: string | null
  location: string | null
  format: string | null
  description: string | null
  capacity: number | null
  time_start: string | null
  time_end: string | null
  dress_code: string | null
  status: 'draft' | 'open' | 'closed' | 'completed'
  applications_open_at: string | null
  applications_close_at: string | null
  created_at: string
}

export type EventWithStats = EventRow & {
  total_applicants: number
  submitted_count: number
  accepted_count: number
  rejected_count: number
  waitlisted_count: number
}

// =============================================================================
// Queries
// =============================================================================

const EVENT_COLUMNS =
  'id,name,slug,event_date,location,format,description,capacity,time_start,time_end,dress_code,status,applications_open_at,applications_close_at,created_at'

/**
 * Fetch all events (non-deleted) ordered by date descending.
 */
export async function fetchAllEvents(): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .is('deleted_at', null)
    .order('event_date', { ascending: false })
  if (error) throw error
  return (data ?? []) as EventRow[]
}

/**
 * Fetch a single event by ID.
 */
export async function fetchEvent(id: string): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return (data as EventRow) ?? null
}

/**
 * Fetch all events with per-event application status counts.
 * Does two queries (events + grouped application counts) and merges client-side
 * to avoid needing a DB view or RPC.
 */
export async function fetchEventsWithStats(): Promise<EventWithStats[]> {
  // 1. All events
  const events = await fetchAllEvents()

  // 2. Application counts grouped by event_id + status
  const { data: counts, error } = await supabase
    .from('applications')
    .select('event_id, status')
    .is('deleted_at', null)

  if (error) throw error

  // Aggregate counts per event
  const statsMap: Record<string, {
    total: number; submitted: number; accepted: number
    rejected: number; waitlisted: number
  }> = {}

  for (const row of counts ?? []) {
    const eid = row.event_id as string
    if (!statsMap[eid]) {
      statsMap[eid] = { total: 0, submitted: 0, accepted: 0, rejected: 0, waitlisted: 0 }
    }
    const s = statsMap[eid]
    s.total++
    const st = row.status as string
    if (st === 'submitted') s.submitted++
    else if (st === 'accepted') s.accepted++
    else if (st === 'rejected') s.rejected++
    else if (st === 'waitlist') s.waitlisted++
  }

  return events.map(e => ({
    ...e,
    total_applicants: statsMap[e.id]?.total ?? 0,
    submitted_count: statsMap[e.id]?.submitted ?? 0,
    accepted_count: statsMap[e.id]?.accepted ?? 0,
    rejected_count: statsMap[e.id]?.rejected ?? 0,
    waitlisted_count: statsMap[e.id]?.waitlisted ?? 0,
  }))
}

/**
 * Update an event's editable fields.
 */
export async function updateEvent(
  id: string,
  patch: Partial<Pick<EventRow,
    'name' | 'location' | 'time_start' | 'time_end' | 'dress_code' |
    'status' | 'capacity' | 'description' | 'event_date'
  >>,
): Promise<EventRow> {
  const { data, error } = await supabase
    .from('events')
    .update(patch)
    .eq('id', id)
    .select(EVENT_COLUMNS)
    .single()
  if (error) throw error
  return data as EventRow
}
