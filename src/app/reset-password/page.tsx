'use client'

// ---------------------------------------------------------------------------
// /reset-password — landing page for the password-reset link Supabase emails.
//
// Wave 1 redesign (Apr 2026): same split-pane layout as /login so the user
// transitions smoothly from clicking "Forgot password?" to setting a new
// one. Recovery-token mechanics are unchanged — Supabase consumes the
// token from the URL hash on mount, fires PASSWORD_RECOVERY, and then
// auth.updateUser({ password }) writes the new hash + invalidates the
// recovery token. Token security is delegated to Supabase: hashed in
// auth.flow_state, single-use, expires per the project's auth config
// (currently 20 minutes — mailer_otp_exp = 1200s).
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'

type Status = 'checking' | 'ready' | 'invalid' | 'saving' | 'saved'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const sub = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'PASSWORD_RECOVERY' && session) {
        setStatus('ready')
      }
    })

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      if (data.session) {
        setStatus(prev => prev === 'checking' ? 'ready' : prev)
      }
    })

    const timeout = setTimeout(() => {
      if (cancelled) return
      setStatus(prev => prev === 'checking' ? 'invalid' : prev)
    }, 3000)

    return () => {
      cancelled = true
      clearTimeout(timeout)
      sub.data.subscription.unsubscribe()
    }
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (password.length < 8) {
      setErr('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setErr('Passwords do not match.')
      return
    }
    setStatus('saving')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setStatus('ready')
      const m = error.message.toLowerCase()
      if (m.includes('strong') || m.includes('weak') || m.includes('character of each')) {
        setErr('Use at least 8 characters with a mix of letters, numbers and symbols.')
      } else if (m.includes('same') || m.includes('different')) {
        setErr('Pick a different password from your last one.')
      } else {
        setErr(error.message)
      }
      return
    }
    setStatus('saved')
    setTimeout(() => router.push('/hub'), 1500)
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-white">
      <aside className="relative bg-steps-dark text-white px-6 py-10 lg:flex-1 lg:px-14 lg:py-14 lg:flex lg:flex-col lg:justify-between overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-tsf-grain pointer-events-none" />
        <div aria-hidden className="absolute inset-0 bg-tsf-hero-grid opacity-30 pointer-events-none" />
        <div aria-hidden className="absolute -top-32 -right-24 w-96 h-96 rounded-full bg-steps-blue-700/30 blur-3xl pointer-events-none" />
        <div aria-hidden className="absolute -bottom-32 -left-24 w-96 h-96 rounded-full bg-steps-sunrise/15 blur-3xl pointer-events-none" />

        <div className="relative z-10 animate-tsf-fade-up">
          <Link
            href="/login"
            aria-label="Back to The Steps Foundation sign-in"
            className="inline-flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-steps-dark"
          >
            <Image src="/tsf-logo-white.png" alt="The Steps Foundation" width={220} height={55} priority className="h-12 w-auto" />
          </Link>
        </div>

        <div className="relative z-10 mt-10 lg:mt-0 max-w-md animate-tsf-fade-up-1">
          <p className="text-xs uppercase tracking-[0.2em] text-steps-mist/80 font-semibold">Account security</p>
          <h1 className="font-display-tight text-4xl sm:text-5xl lg:text-6xl font-black mt-3 text-white">
            Set a fresh password.
          </h1>
          <p className="mt-5 text-base lg:text-lg text-steps-mist/90 leading-relaxed">
            Reset links expire 20 minutes after they&apos;re sent and can only be used once.
            Choose something you can remember but no one else would guess.
          </p>
        </div>

        <div className="relative z-10 mt-10 lg:mt-0 hidden lg:block animate-tsf-fade-up-2">
          <div className="flex items-center gap-3">
            <div className="h-px w-10 bg-steps-mist/40" aria-hidden />
            <em className="not-italic text-steps-mist/80 text-sm tracking-[0.2em] uppercase">Virtus non origo</em>
          </div>
        </div>
      </aside>

      <main className="relative flex-1 flex items-center justify-center px-4 sm:px-6 py-10 lg:py-14 bg-gradient-to-b from-white to-slate-50">
        <div className="w-full max-w-md animate-tsf-fade-up-2">
          <div className="text-center lg:text-left mb-8">
            <h2 className="font-display text-3xl font-black text-steps-dark tracking-tight">New password</h2>
            <p className="text-slate-500 mt-2 text-sm">After you save, we&apos;ll take you to the intranet.</p>
          </div>

          {status === 'checking' && (
            <div role="status" aria-live="polite" className="text-center py-10">
              <div aria-hidden className="animate-spin w-7 h-7 border-2 border-steps-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-sm text-slate-500">Verifying your link…</p>
            </div>
          )}

          {status === 'invalid' && (
            <div className="space-y-4 text-center bg-red-50 border border-red-200 rounded-2xl p-6">
              <div className="w-12 h-12 mx-auto rounded-full bg-red-100 text-red-700 flex items-center justify-center" aria-hidden>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                </svg>
              </div>
              <p className="text-sm text-red-700">
                This reset link is invalid or has expired. Reset links are single-use and expire 20 minutes after they&apos;re sent.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center justify-center px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              >
                Request a new link
              </Link>
            </div>
          )}

          {status === 'saved' && (
            <div role="status" aria-live="polite" className="text-center py-10 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-3 animate-tsf-fade-in">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="font-display text-lg font-bold text-emerald-900">Password updated</p>
              <p className="text-sm text-emerald-800/80">Taking you to the intranet…</p>
            </div>
          )}

          {(status === 'ready' || status === 'saving') && (
            <form onSubmit={handleSave} className="space-y-4" noValidate>
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <label htmlFor="new-password" className="block text-sm font-medium text-slate-700">New password</label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    className="text-xs font-medium text-steps-blue-600 hover:text-steps-blue-700"
                    aria-pressed={showPassword}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  autoFocus
                  disabled={status === 'saving'}
                  placeholder="At least 8 characters"
                  aria-describedby="password-help"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-slate-50"
                />
                <p id="password-help" className="text-xs text-slate-500 mt-1.5">
                  Mix letters, numbers and symbols for stronger protection.
                </p>
              </div>
              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 mb-1.5">Confirm password</label>
                <input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  disabled={status === 'saving'}
                  placeholder="Re-enter the password"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-slate-50"
                />
              </div>
              {err && (
                <p role="alert" aria-live="polite" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">{err}</p>
              )}
              <button
                type="submit"
                disabled={status === 'saving' || !password || !confirm}
                className="w-full py-3 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2"
              >
                {status === 'saving' ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
