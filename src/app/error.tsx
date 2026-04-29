'use client'

// ---------------------------------------------------------------------------
// Top-level route error boundary. Triggers when a server or client component
// throws inside any route under the root layout. Users get a friendly recovery
// page with two ways out — try again (which calls Next's reset) or jump to a
// known-good area of the app.
//
// We deliberately don't show the raw error message to non-team users — they
// see the digest only, which they can quote when emailing the team.
// ---------------------------------------------------------------------------

import { useEffect } from 'react'
import Link from 'next/link'

export default function GlobalRouteError({
  error, reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Vercel captures console.error on the server; this also fires on the
    // client so the team can see what blew up via the browser console + the
    // Vercel runtime logs. Replace with Sentry/Logflare when wiring up an
    // external aggregator.
    console.error('[error.tsx] caught:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-w-md w-full text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mb-4">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3l-7.07-12.25a2 2 0 00-3.48 0L3.19 16a2 2 0 001.74 3z" />
          </svg>
        </div>
        <h1 className="font-display text-2xl font-bold text-steps-dark mb-2">Something went wrong</h1>
        <p className="text-sm text-slate-600 mb-1">
          Sorry — we hit an unexpected error. The team has been notified.
        </p>
        {error.digest && (
          <p className="text-xs text-slate-400 font-mono mb-5">Reference: {error.digest}</p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 bg-steps-blue-600 text-white text-sm font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150"
          >
            Try again
          </button>
          <Link
            href="/my"
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors"
          >
            Back to Student Hub
          </Link>
        </div>
        <p className="text-xs text-slate-400 mt-6">
          Stuck? Email <a href="mailto:hello@thestepsfoundation.com" className="text-steps-blue-600 hover:underline">hello@thestepsfoundation.com</a>{error.digest ? <> with reference <code className="font-mono">{error.digest}</code></> : null}.
        </p>
      </div>
    </div>
  )
}
