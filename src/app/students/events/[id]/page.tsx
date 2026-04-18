'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { EventRow, fetchEvent } from '@/lib/events-api'

export default function EventDetailPage() {
  const params = useParams()
  const eventId = params.id as string
  const [event, setEvent] = useState<EventRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetchEvent(eventId)
      .then(data => { if (active) { setEvent(data); setLoading(false) } })
      .catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [eventId])

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-gray-500 dark:text-gray-400">Loading event…</div>
      </main>
    )
  }

  if (!event) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-red-600 dark:text-red-400">Event not found.</div>
        <Link href="/students/events" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mt-2 inline-block">
          Back to Events
        </Link>
      </main>
    )
  }

  const formattedDate = event.event_date
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : 'Date TBC'

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link href="/students/events" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
          &larr; Events
        </Link>
      </div>

      {/* Event header */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">{event.name}</h1>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
          <span>{formattedDate}</span>
          {event.time_start && <span>{event.time_start}{event.time_end ? ` – ${event.time_end}` : ''}</span>}
          {event.location && <span>{event.location}</span>}
          {event.capacity != null && <span>Capacity: {event.capacity}</span>}
          {event.dress_code && <span>Dress code: {event.dress_code}</span>}
        </div>
        {event.description && (
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{event.description}</p>
        )}
      </div>

      {/* Placeholder for Phase 2: Applicant Manager */}
      <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-10 text-center">
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          Applicant manager coming in Phase 2 — bulk actions, filters, email sending, and audit trail.
        </p>
      </div>
    </main>
  )
}
