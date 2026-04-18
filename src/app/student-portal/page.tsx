'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { sendOtp, verifyOtp, lookupSelf, signOutStudent, type StudentSelf } from '@/lib/apply-api'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PortalStep = 'login' | 'otp' | 'dashboard'

type ApplicationRow = {
  id: string
  event_id: string
  status: string
  created_at: string
  event_name?: string
}

// Known events for display names
const EVENT_NAMES: Record<string, string> = {
  'b5e7f8a1-3c9d-4b2e-8f1a-6d7c8e9f0a1b': 'Man Group Office Visit',
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Portal Page
// ---------------------------------------------------------------------------

export default function PortalPage() {
  const [step, setStep] = useState<PortalStep>('login')
  const [email, setEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)

  // Dashboard state
  const [student, setStudent] = useState<StudentSelf | null>(null)
  const [applications, setApplications] = useState<ApplicationRow[]>([])
  const [userEmail, setUserEmail] = useState<string | null>(null)

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email) {
        setUserEmail(user.email)
        setEmail(user.email)
        await loadDashboard()
        setStep('dashboard')
      }
      setCheckingSession(false)
    }
    checkSession()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDashboard = useCallback(async () => {
    // Load student profile
    const self = await lookupSelf()
    setStudent(self)

    // Load applications
    if (self) {
      const { data } = await supabase
        .from('applications')
        .select('id, event_id, status, created_at')
        .eq('student_id', self.id)
        .order('created_at', { ascending: false })

      if (data) {
        setApplications(
          data.map((a: ApplicationRow) => ({
            ...a,
            event_name: EVENT_NAMES[a.event_id] || 'Event',
          }))
        )
      }
    }
  }, [])

  // --- Email submit ---
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error: otpError } = await sendOtp(email)
    if (otpError) {
      setError(otpError)
    } else {
      setStep('otp')
    }
    setLoading(false)
  }

  // --- OTP verify ---
  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error: verifyError } = await verifyOtp(email, otpCode)
    if (verifyError) {
      setError(verifyError)
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    setUserEmail(user?.email ?? email)
    await loadDashboard()
    setStep('dashboard')
    setLoading(false)
  }

  // --- Sign out ---
  const handleSignOut = async () => {
    await signOutStudent()
    setStep('login')
    setEmail('')
    setOtpCode('')
    setStudent(null)
    setApplications([])
    setUserEmail(null)
    setError(null)
  }

  // --- Loading screen ---
  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3">
          <Spinner className="h-6 w-6 text-purple-600" />
          <span className="text-gray-600">Loading portal...</span>
        </div>
      </div>
    )
  }

  // --- Status badge ---
  const StatusBadge = ({ status }: { status: string }) => {
    const styles: Record<string, string> = {
      submitted: 'bg-blue-100 text-blue-700',
      under_review: 'bg-yellow-100 text-yellow-700',
      accepted: 'bg-green-100 text-green-700',
      waitlisted: 'bg-orange-100 text-orange-700',
      rejected: 'bg-red-100 text-red-700',
    }
    const labels: Record<string, string> = {
      submitted: 'Submitted',
      under_review: 'Under Review',
      accepted: 'Accepted',
      waitlisted: 'Waitlisted',
      rejected: 'Not Successful',
    }
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-700'}`}>
        {labels[status] || status}
      </span>
    )
  }

  // =========================================================================
  // RENDER: Login
  // =========================================================================
  if (step === 'login') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-purple-600 rounded-xl flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl font-bold text-white tracking-tight">SF</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Steps Foundation</h1>
            <p className="text-gray-500 mt-2">Student Portal</p>
          </div>

          <p className="text-sm text-gray-600 text-center mb-6">
            Sign in with the email you used to apply. We&rsquo;ll send you a verification code.
          </p>

          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label htmlFor="portal-email" className="block text-sm font-medium text-gray-700 mb-2">
                Email address
              </label>
              <input
                id="portal-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@example.com"
                required
                disabled={loading}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition disabled:bg-gray-50 disabled:cursor-not-allowed"
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700 border border-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full py-3 px-4 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <><Spinner /> Sending code...</> : 'Send verification code'}
            </button>
          </form>

          {/* Link to apply */}
          <div className="mt-6 text-center">
            <p className="text-xs text-gray-400">
              Haven&rsquo;t applied yet?{' '}
              <Link href="/apply/man-group-office-visit" className="text-purple-600 hover:text-purple-700 font-medium">
                Apply for an event
              </Link>
            </p>
          </div>

          <p className="text-center text-xs text-gray-400 mt-4">
            <em>Virtus non origo</em> — Character, not origin
          </p>
        </div>
      </div>
    )
  }

  // =========================================================================
  // RENDER: OTP Verification
  // =========================================================================
  if (step === 'otp') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-purple-600 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Check your email</h1>
            <p className="text-gray-500 mt-2">
              We sent a 6-digit code to <span className="font-medium text-gray-700">{email}</span>
            </p>
          </div>

          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div>
              <label htmlFor="portal-otp" className="block text-sm font-medium text-gray-700 mb-2">
                Verification code
              </label>
              <input
                id="portal-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                required
                disabled={loading}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition text-center text-2xl tracking-[0.3em] font-mono disabled:bg-gray-50 disabled:cursor-not-allowed"
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700 border border-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || otpCode.length !== 6}
              className="w-full py-3 px-4 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <><Spinner /> Verifying...</> : 'Verify & sign in'}
            </button>
          </form>

          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => { setStep('login'); setOtpCode(''); setError(null) }}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Use a different email
            </button>
            <button
              onClick={async () => {
                setError(null)
                const { error: resendErr } = await sendOtp(email)
                if (resendErr) setError(resendErr)
              }}
              className="text-sm text-purple-600 hover:text-purple-700 font-medium"
            >
              Resend code
            </button>
          </div>
        </div>
      </div>
    )
  }

  // =========================================================================
  // RENDER: Dashboard
  // =========================================================================
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <span className="font-semibold text-gray-900">
            Steps <span className="text-purple-600">Foundation</span>
            <span className="text-gray-400 font-normal ml-2 text-sm">Student Portal</span>
          </span>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-gray-500">{userEmail}</span>
            <button
              onClick={handleSignOut}
              className="text-sm px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        {/* Greeting */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            {student ? `Hi, ${student.first_name}` : 'Welcome'}
          </h1>
          <p className="text-gray-500 mt-1">
            View your applications and manage your profile.
          </p>
        </div>

        {/* Applications */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Applications</h2>

          {applications.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-gray-500 mb-4">You haven&rsquo;t submitted any applications yet.</p>
              <Link
                href="/apply/man-group-office-visit"
                className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition"
              >
                Apply for Man Group Office Visit
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {applications.map((app) => (
                <div key={app.id} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{app.event_name}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Applied {new Date(app.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                  <StatusBadge status={app.status} />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Profile Summary */}
        {student && (
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Details</h2>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-gray-500">Name</dt>
                  <dd className="font-medium text-gray-900">{student.first_name} {student.last_name}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Email</dt>
                  <dd className="font-medium text-gray-900">{student.personal_email}</dd>
                </div>
                {student.school_name_raw && (
                  <div>
                    <dt className="text-gray-500">School</dt>
                    <dd className="font-medium text-gray-900">{student.school_name_raw}</dd>
                  </div>
                )}
                {student.year_group && (
                  <div>
                    <dt className="text-gray-500">Year Group</dt>
                    <dd className="font-medium text-gray-900">Year {student.year_group}</dd>
                  </div>
                )}
              </dl>
            </div>
          </section>
        )}

        <p className="text-center text-xs text-gray-400 mt-12">
          <em>Virtus non origo</em> — Character, not origin
        </p>
      </main>
    </div>
  )
}
