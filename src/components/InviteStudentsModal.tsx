'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { type EnrichedStudent, fetchAllStudentsEnriched, EVENTS } from '@/lib/students-api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = {
  eventId: string
  eventName: string
  eventSlug: string
  teamMemberUuid: string | null
  onClose: () => void
  onSent: (count: number) => void
}

type Step = 'select' | 'compose' | 'preview' | 'sending' | 'done'

type Template = {
  id: string
  name: string
  type: string
  subject: string
  body_html: string
  event_id: string | null
}

// Email signature — matches the real events@ Gmail signature
const EMAIL_SIGNATURE_HTML = `
<br>
<table style="color:rgb(34,34,34);direction:ltr;border-collapse:collapse">
<tbody><tr><td>
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:508px">
<tbody><tr><td>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;line-height:1.15;color:rgb(0,0,0)">
<tbody><tr>
<td style="vertical-align:top;padding:0.01px 14px 0.01px 1px;width:65px;text-align:center">
<img width="96" height="96" src="https://drive.google.com/uc?export=view&id=1opsHkt2hbBhGdYHVQrWpNjK8lGZnydjS" alt="The Steps Foundation">
</td>
<td valign="top" style="padding:0.01px 0.01px 0.01px 14px;vertical-align:top;border-left:1px solid rgb(189,189,189)">
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tbody>
<tr><td style="padding:0.01px">
<p style="margin:0.1px;line-height:19.2px;font-size:16px"><font style="color:rgb(100,100,100)" face="arial, sans-serif"><b>The Steps Foundation</b></font></p>
<p style="margin:0.1px;line-height:19.2px"><font face="arial, sans-serif"><i style="font-size:11px;text-align:center">Virtus, non Origo. \u2013 Character, not Origin.</i></font></p>
</td></tr>
<tr><td>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tbody><tr><td nowrap style="padding-top:14px">
<p style="margin:1px;line-height:10.89px;font-size:11px;color:rgb(33,33,33)"><a href="mailto:events@thestepsfoundation.com" style="color:rgb(17,85,204)">events@thestepsfoundation.com</a></p>
</td></tr></tbody>
</table>
</td></tr>
</tbody></table>
</td>
</tr></tbody></table>
</td></tr></tbody></table>
</td></tr></tbody></table>
<p style="margin:0cm;font-size:9pt;color:red;font-family:arial,sans-serif;font-style:italic;margin-top:12px">
This message is intended only for the addressee and may contain information that is confidential or privileged. Unauthorised use is strictly prohibited and may be unlawful. If you are not the addressee, you should not read, copy, disclose or otherwise use this message, except for the purpose of delivery to the addressee. If you have received this in error, please delete it and advise The Steps Foundation.
</p>
`

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InviteStudentsModal({ eventId, eventName, eventSlug, teamMemberUuid, onClose, onSent }: Props) {
  // Data
  const [students, setStudents] = useState<EnrichedStudent[]>([])
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState<Template[]>([])

  // Filters
  const [yearFilter, setYearFilter] = useState<string[]>([])
  const [minScore, setMinScore] = useState(0)
  const [pastEventFilter, setPastEventFilter] = useState<string>('any') // any | attended_any | never_applied
  const [search, setSearch] = useState('')

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Compose
  const [step, setStep] = useState<Step>('select')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')

  // Send progress
  const [sendProgress, setSendProgress] = useState({ sent: 0, failed: 0, total: 0 })

  // Template management
  const [showTemplateEditor, setShowTemplateEditor] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [templateDraft, setTemplateDraft] = useState({ name: '', type: 'custom', subject: '', body_html: '' })
  const [templateSaving, setTemplateSaving] = useState(false)

  // ---------------------------------------------------------------------------
  // Load data
  // ---------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    setLoading(true)
    const [enriched, { data: appData }, { data: tplData }] = await Promise.all([
      fetchAllStudentsEnriched({ forceRefresh: true }),
      supabase.from('applications').select('student_id').eq('event_id', eventId).is('deleted_at', null),
      supabase.from('email_templates').select('id, name, type, subject, body_html, event_id').is('deleted_at', null).order('created_at', { ascending: false }),
    ])
    const applied = new Set((appData ?? []).map((a: any) => a.student_id))
    setAppliedIds(applied)
    // Only include students who haven't applied and aren't ineligible
    setStudents(enriched.filter(s => !applied.has(s.id) && s.eligibility !== 'ineligible' && s.personal_email))
    setTemplates((tplData ?? []) as Template[])
    setLoading(false)
  }, [eventId])

  useEffect(() => { loadData() }, [loadData])

  // ---------------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------------

  const yearGroups = useMemo(() => {
    const yrs = new Set(students.map(s => s.year_group).filter((y): y is string => y != null))
    return Array.from(yrs).sort((a, b) => Number(a) - Number(b))
  }, [students])

  const filtered = useMemo(() => {
    return students.filter(s => {
      if (yearFilter.length && (s.year_group == null || !yearFilter.includes(s.year_group))) return false
      if (minScore > 0 && s.engagement_score < minScore) return false
      if (pastEventFilter === 'attended_any' && s.attended_count === 0) return false
      if (pastEventFilter === 'never_applied' && s.submitted_count > 0) return false
      if (search) {
        const q = search.toLowerCase()
        if (!`${s.first_name} ${s.last_name}`.toLowerCase().includes(q) &&
            !(s.school_name_raw ?? '').toLowerCase().includes(q) &&
            !(s.personal_email ?? '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [students, yearFilter, minScore, pastEventFilter, search])

  // Pagination
  const PAGE_SIZE = 50
  const [page, setPage] = useState(0)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageStudents = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Reset page when filters change
  useEffect(() => { setPage(0) }, [yearFilter, minScore, pastEventFilter, search])

  // ---------------------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------------------

  const toggleAll = () => {
    const pageIds = pageStudents.map(s => s.id)
    const allSelected = pageIds.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      pageIds.forEach(id => allSelected ? next.delete(id) : next.add(id))
      return next
    })
  }

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(filtered.map(s => s.id)))
  }

  // ---------------------------------------------------------------------------
  // Compose helpers
  // ---------------------------------------------------------------------------

  const applyLink = `https://the-steps-foundation-intranet.vercel.app/apply/${eventSlug}`

  const fillMerge = (text: string, s: EnrichedStudent): string => {
    return text
      .replace(/\{\{first_name\}\}/g, s.first_name ?? '')
      .replace(/\{\{last_name\}\}/g, s.last_name ?? '')
      .replace(/\{\{full_name\}\}/g, `${s.first_name ?? ''} ${s.last_name ?? ''}`)
      .replace(/\{\{email\}\}/g, String(s.personal_email ?? ''))
      .replace(/\{\{event_name\}\}/g, eventName)
      .replace(/\{\{apply_link\}\}/g, applyLink)
  }

  const recipients = students.filter(s => selected.has(s.id))
  const firstRecipient = recipients[0]

  const applyTemplate = (tplId: string) => {
    const tpl = templates.find(t => t.id === tplId)
    if (!tpl) return
    setSelectedTemplate(tplId)
    setEmailSubject(tpl.subject)
    setEmailBody(tpl.body_html)
  }

  // ---------------------------------------------------------------------------
  // Template CRUD
  // ---------------------------------------------------------------------------

  const startNewTemplate = () => {
    setTemplateDraft({ name: '', type: 'custom', subject: '', body_html: '' })
    setEditingTemplate(null)
    setShowTemplateEditor(true)
  }

  const startEditTemplate = (t: Template) => {
    setTemplateDraft({ name: t.name, type: t.type, subject: t.subject, body_html: t.body_html })
    setEditingTemplate(t)
    setShowTemplateEditor(true)
  }

  const saveTemplate = async () => {
    setTemplateSaving(true)
    const payload = {
      name: templateDraft.name,
      type: templateDraft.type,
      subject: templateDraft.subject,
      body_html: templateDraft.body_html,
      event_id: eventId,
      updated_by: teamMemberUuid,
    }
    try {
      if (editingTemplate) {
        await supabase.from('email_templates').update(payload).eq('id', editingTemplate.id)
      } else {
        await supabase.from('email_templates').insert({ ...payload, created_by: teamMemberUuid })
      }
      // Reload templates
      const { data } = await supabase.from('email_templates').select('id, name, type, subject, body_html, event_id').is('deleted_at', null).order('created_at', { ascending: false })
      setTemplates((data ?? []) as Template[])
      setShowTemplateEditor(false)
    } finally {
      setTemplateSaving(false)
    }
  }

  const deleteTemplate = async (id: string) => {
    if (!confirm('Delete this template?')) return
    await supabase.from('email_templates').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    const { data } = await supabase.from('email_templates').select('id, name, type, subject, body_html, event_id').is('deleted_at', null).order('created_at', { ascending: false })
    setTemplates((data ?? []) as Template[])
  }

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  const sendInvites = async () => {
    setStep('sending')
    setSendProgress({ sent: 0, failed: 0, total: recipients.length })

    for (const student of recipients) {
      const renderedSubject = fillMerge(emailSubject, student)
      const renderedBody = fillMerge(emailBody, student)
      const fullBody = renderedBody + EMAIL_SIGNATURE_HTML

      try {
        // Insert email_log
        await supabase.from('email_log').insert({
          student_id: student.id,
          event_id: eventId,
          template_id: selectedTemplate || null,
          to_email: student.personal_email!,
          from_email: 'events@thestepsfoundation.com',
          subject: renderedSubject,
          body_html: fullBody,
          status: 'pending',
          sent_by: teamMemberUuid,
        })

        // Send via API route
        const res = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: student.personal_email!, subject: renderedSubject, html: fullBody }),
        })

        if (res.ok) {
          setSendProgress(p => ({ ...p, sent: p.sent + 1 }))
        } else {
          setSendProgress(p => ({ ...p, failed: p.failed + 1 }))
        }
      } catch {
        setSendProgress(p => ({ ...p, failed: p.failed + 1 }))
      }
    }
    setStep('done')
  }

  // ---------------------------------------------------------------------------
  // Event label helpers
  // ---------------------------------------------------------------------------

  const eventLabels = useMemo(() => {
    const map: Record<string, string> = {}
    if (EVENTS) {
      EVENTS.forEach((e: any) => { map[e.id] = e.short ?? e.name })
    }
    return map
  }, [])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-8 text-center" onClick={e => e.stopPropagation()}>
          <div className="text-sm text-gray-500">Loading students…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {step === 'select' ? 'Invite Students' : step === 'compose' ? 'Compose Invite Email' : step === 'preview' ? 'Preview' : step === 'sending' ? 'Sending…' : 'Done'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {step === 'select' && `${filtered.length} eligible students (${students.length} total, excluding ${appliedIds.size} already applied)`}
              {step === 'compose' && `${selected.size} students selected`}
              {step === 'preview' && `Sending to ${recipients.length} student${recipients.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">

          {/* ======= STEP: SELECT ======= */}
          {step === 'select' && (
            <>
              {/* Filters row */}
              <div className="flex flex-wrap gap-3 mb-4">
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search name, school, email…"
                  className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 w-56"
                />

                {/* Year group */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 mr-1">Year:</span>
                  {yearGroups.map(y => (
                    <button
                      key={y}
                      onClick={() => setYearFilter(f => f.includes(y) ? f.filter(v => v !== y) : [...f, y])}
                      className={`px-2 py-1 text-xs rounded-md border ${
                        yearFilter.includes(y)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      Y{y}
                    </button>
                  ))}
                </div>

                {/* Min score */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">Min score:</span>
                  <input
                    type="number"
                    value={minScore}
                    onChange={e => setMinScore(Number(e.target.value))}
                    className="w-14 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                    min={0}
                  />
                </div>

                {/* Past events */}
                <select
                  value={pastEventFilter}
                  onChange={e => setPastEventFilter(e.target.value)}
                  className="px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                >
                  <option value="any">All students</option>
                  <option value="attended_any">Attended a past event</option>
                  <option value="never_applied">Never applied before</option>
                </select>
              </div>

              {/* Bulk actions */}
              {selected.size > 0 && (
                <div className="mb-3 flex items-center gap-3 text-sm">
                  <span className="font-medium text-indigo-600 dark:text-indigo-400">{selected.size} selected</span>
                  <button onClick={selectAll} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                    Select all {filtered.length}
                  </button>
                  <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:underline">
                    Clear
                  </button>
                </div>
              )}

              {/* Table */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/50">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <input type="checkbox" checked={pageStudents.length > 0 && pageStudents.every(s => selected.has(s.id))} onChange={toggleAll} />
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">School</th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Year</th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Events</th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Eligibility</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {pageStudents.map(s => (
                      <tr key={s.id} className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 ${selected.has(s.id) ? 'bg-indigo-50 dark:bg-indigo-900/10' : ''}`}>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                          {s.first_name} {s.last_name}
                          <div className="text-xs text-gray-400">{s.personal_email}</div>
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400 text-xs">{s.school_name_raw ?? '—'}</td>
                        <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">{s.year_group ?? '—'}</td>
                        <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">
                          {s.submitted_count > 0
                            ? `${s.attended_count}/${s.submitted_count}`
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                            s.eligibility === 'eligible'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                          }`}>
                            {s.eligibility === 'eligible' ? 'Eligible' : 'Unknown'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">{s.engagement_score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
                  <span>Page {page + 1} of {totalPages} ({filtered.length} students)</span>
                  <div className="flex gap-1">
                    <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-30">&laquo;</button>
                    <button onClick={() => setPage(p => p - 1)} disabled={page === 0} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-30">&lsaquo;</button>
                    <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-30">&rsaquo;</button>
                    <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-30">&raquo;</button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ======= STEP: COMPOSE ======= */}
          {step === 'compose' && (
            <div className="space-y-4">
              {/* Templates section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Email Template</label>
                  <button onClick={startNewTemplate} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">+ New template</button>
                </div>

                {showTemplateEditor ? (
                  <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3 mb-3 space-y-3 bg-gray-50 dark:bg-gray-800/50">
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        value={templateDraft.name}
                        onChange={e => setTemplateDraft(d => ({ ...d, name: e.target.value }))}
                        placeholder="Template name"
                        className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                      />
                      <select
                        value={templateDraft.type}
                        onChange={e => setTemplateDraft(d => ({ ...d, type: e.target.value }))}
                        className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                      >
                        <option value="custom">Custom</option>
                        <option value="acceptance">Acceptance</option>
                        <option value="rejection">Rejection</option>
                        <option value="waitlist">Waitlist</option>
                        <option value="reminder">Reminder</option>
                        <option value="follow_up">Follow-up</option>
                      </select>
                    </div>
                    <input
                      value={templateDraft.subject}
                      onChange={e => setTemplateDraft(d => ({ ...d, subject: e.target.value }))}
                      placeholder="Subject line with {{merge_tags}}"
                      className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                    <textarea
                      value={templateDraft.body_html}
                      onChange={e => setTemplateDraft(d => ({ ...d, body_html: e.target.value }))}
                      rows={6}
                      placeholder="Email body HTML with {{merge_tags}}"
                      className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => setShowTemplateEditor(false)} className="px-3 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-700">Cancel</button>
                      <button
                        onClick={saveTemplate}
                        disabled={templateSaving || !templateDraft.name || !templateDraft.subject || !templateDraft.body_html}
                        className="px-3 py-1 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {templateSaving ? 'Saving…' : editingTemplate ? 'Update' : 'Save template'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1 mb-3">
                    {/* Event-specific templates first, then global */}
                    {templates
                      .filter(t => t.event_id === eventId || !t.event_id)
                      .map(t => (
                        <div
                          key={t.id}
                          className={`flex items-center justify-between px-3 py-2 rounded-md cursor-pointer border ${
                            selectedTemplate === t.id
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/30'
                          }`}
                          onClick={() => applyTemplate(t.id)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{t.name}</span>
                            <span className="text-xs text-gray-400">{t.event_id ? 'Event' : 'Global'}</span>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={e => { e.stopPropagation(); startEditTemplate(t) }} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                            <button onClick={e => { e.stopPropagation(); deleteTemplate(t.id) }} className="text-xs text-red-500 hover:underline">Delete</button>
                          </div>
                        </div>
                      ))}
                    {templates.filter(t => t.event_id === eventId || !t.event_id).length === 0 && (
                      <p className="text-xs text-gray-400 py-2">No templates yet. Create one or write a custom email below.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Subject</label>
                <input
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  placeholder="e.g. You're Invited to {{event_name}}!"
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Body (HTML)</label>
                <textarea
                  value={emailBody}
                  onChange={e => setEmailBody(e.target.value)}
                  rows={10}
                  placeholder="<p>Hey {{first_name}},</p><p>We'd love for you to apply to {{event_name}}! Apply here: {{apply_link}}</p>"
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
                />
              </div>

              {/* Merge fields */}
              <div className="text-xs text-gray-500 dark:text-gray-400">
                <span className="font-medium">Merge fields: </span>
                {['{{first_name}}', '{{last_name}}', '{{full_name}}', '{{event_name}}', '{{apply_link}}'].map((f, i, arr) => (
                  <span key={f}>
                    <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{f}</code>
                    {i < arr.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ======= STEP: PREVIEW ======= */}
          {step === 'preview' && firstRecipient && (
            <div className="space-y-4">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Preview with first recipient: <strong>{firstRecipient.first_name} {firstRecipient.last_name}</strong>
              </div>
              <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">From: Events - The Steps Foundation &lt;events@thestepsfoundation.com&gt;</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">To: {firstRecipient.personal_email}</div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                  {fillMerge(emailSubject, firstRecipient)}
                </div>
                <div
                  className="prose dark:prose-invert prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: fillMerge(emailBody, firstRecipient) + EMAIL_SIGNATURE_HTML }}
                />
              </div>
              <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                This will send <strong>{recipients.length}</strong> individual email{recipients.length !== 1 ? 's' : ''} to <strong>{recipients.length}</strong> student{recipients.length !== 1 ? 's' : ''}.
              </div>
            </div>
          )}

          {/* ======= STEP: SENDING ======= */}
          {step === 'sending' && (
            <div className="text-center py-10">
              <div className="text-4xl mb-3">&#9993;</div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Sending {sendProgress.sent + sendProgress.failed} / {sendProgress.total}…
              </div>
              <div className="w-48 mx-auto mt-3 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${sendProgress.total > 0 ? ((sendProgress.sent + sendProgress.failed) / sendProgress.total) * 100 : 0}%` }} />
              </div>
            </div>
          )}

          {/* ======= STEP: DONE ======= */}
          {step === 'done' && (
            <div className="text-center py-10">
              <div className="text-4xl mb-3">&#10003;</div>
              <div className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-1">Invites sent!</div>
              <div className="text-sm text-gray-500">
                {sendProgress.sent} sent{sendProgress.failed > 0 ? `, ${sendProgress.failed} failed` : ''}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex justify-between shrink-0">
          {step === 'select' && (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200">Cancel</button>
              <button
                onClick={() => setStep('compose')}
                disabled={selected.size === 0}
                className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Next: Compose email ({selected.size})
              </button>
            </>
          )}
          {step === 'compose' && (
            <>
              <button onClick={() => setStep('select')} className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200">&larr; Back</button>
              <button
                onClick={() => setStep('preview')}
                disabled={!emailSubject || !emailBody}
                className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Preview
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button onClick={() => setStep('compose')} className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200">&larr; Edit</button>
              <button
                onClick={sendInvites}
                className="px-4 py-2 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Send {recipients.length} invite{recipients.length !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {step === 'done' && (
            <div className="w-full text-right">
              <button onClick={() => { onSent(sendProgress.sent); onClose() }} className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
