'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  EVENTS,
  StudentRow,
  ApplicationRow,
  StudentUpdate,
  ApplicationUpdate,
  fetchStudent,
  enrich,
  updateStudent,
  upsertApplication,
  deleteApplication,
} from '@/lib/students-api'

const STATUS_OPTIONS = ['submitted', 'shortlisted', 'accepted', 'waitlist', 'rejected', 'withdrew'] as const

export default function StudentProfilePage({ params }: { params: { id: string } }) {
  const { id } = params
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [apps, setApps] = useState<ApplicationRow[]>([])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<StudentUpdate>({})
  const [saving, setSaving] = useState(false)
  const [rowSaving, setRowSaving] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchStudent(id)
      .then(({ student, applications }) => {
        if (!active) return
        setStudent(student)
        setApps(applications)
        setLoading(false)
      })
      .catch(err => {
        if (!active) return
        setError(err?.message ?? 'Failed to load')
        setLoading(false)
      })
    return () => { active = false }
  }, [id])

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  function startEdit() {
    if (!student) return
    setDraft({
      first_name: student.first_name,
      last_name: student.last_name,
      personal_email: student.personal_email,
      school_name_raw: student.school_name_raw,
      year_group: student.year_group,
      free_school_meals: student.free_school_meals,
      parental_income_band: student.parental_income_band,
      first_generation_uni: student.first_generation_uni,
      subscribed_to_mailing: student.subscribed_to_mailing,
      notes: student.notes,
    })
    setEditing(true)
  }

  async function saveStudent() {
    if (!student) return
    setSaving(true)
    try {
      const updated = await updateStudent(student.id, draft)
      setStudent(updated)
      setEditing(false)
      flash('Saved')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function saveRow(eventId: string, patch: ApplicationUpdate) {
    if (!student) return
    const existing = apps.find(a => a.event_id === eventId)
    setRowSaving(eventId)
    try {
      const row = await upsertApplication(student.id, eventId, patch, existing?.id)
      setApps(prev => {
        const others = prev.filter(a => a.event_id !== eventId)
        return [...others, row]
      })
      flash('Updated')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update application')
    } finally {
      setRowSaving(null)
    }
  }

  async function removeRow(appId: string) {
    if (!confirm('Delete this application record?')) return
    setRowSaving(appId)
    try {
      await deleteApplication(appId)
      setApps(prev => prev.filter(a => a.id !== appId))
      flash('Deleted')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete')
    } finally {
      setRowSaving(null)
    }
  }

  if (loading) return <div className="max-w-5xl mx-auto p-8 text-gray-500">Loading…</div>
  if (error) return <div className="max-w-5xl mx-auto p-8 text-red-600">{error}</div>
  if (!student) return <div className="max-w-5xl mx-auto p-8 text-gray-500">Student not found.</div>

  const enriched = enrich(student, apps.map(a => ({ ...a, student_id: student.id })))
  const fullName = `${student.first_name || ''} ${student.last_name || ''}`.trim() || student.personal_email || 'Unnamed'

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/students" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">← All students</Link>
        {toast && <span className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded">{toast}</span>}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{fullName}</h1>
          <div className="mt-1 text-sm text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
            {student.personal_email && <span>{student.personal_email}</span>}
            {student.school_name_raw && <span>{student.school_name_raw}</span>}
            {student.year_group && <span>{student.year_group}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge label={`${enriched.attended_count} attended`} tone="emerald" />
          {enriched.no_show_count > 0 && <Badge label={`${enriched.no_show_count} no-show`} tone="amber" />}
          <Badge label={`Score ${enriched.engagement_score}`} tone="indigo" />
          {!editing ? (
            <button onClick={startEdit} className="ml-2 px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700">Edit</button>
          ) : (
            <div className="flex gap-2 ml-2">
              <button onClick={() => setEditing(false)} disabled={saving} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200">Cancel</button>
              <button onClick={saveStudent} disabled={saving} className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          )}
        </div>
      </div>

      {/* Details */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 mb-6">
        <h2 className="font-medium text-gray-900 dark:text-gray-100 mb-4">Details</h2>
        {!editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Field label="First name" value={student.first_name} />
            <Field label="Last name" value={student.last_name} />
            <Field label="Email" value={student.personal_email} />
            <Field label="School" value={student.school_name_raw} />
            <Field label="Year group" value={student.year_group} />
            <Field label="Income band" value={student.parental_income_band} />
            <Field label="Free school meals" value={boolLabel(student.free_school_meals)} />
            <Field label="First-gen uni" value={boolLabel(student.first_generation_uni)} />
            <Field label="Mailing list" value={boolLabel(student.subscribed_to_mailing)} />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <Input label="First name" value={draft.first_name ?? ''} onChange={v => setDraft(d => ({ ...d, first_name: v }))} />
            <Input label="Last name" value={draft.last_name ?? ''} onChange={v => setDraft(d => ({ ...d, last_name: v }))} />
            <Input label