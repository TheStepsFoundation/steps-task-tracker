'use client'

// ---------------------------------------------------------------------------
// Last-line-of-defence error boundary. Triggers when the root layout itself
// throws (e.g. providers crash). Must render its own <html>/<body> tags
// because there's no layout to wrap us. Inline styles only — globals.css
// might not be applied in this state.
// ---------------------------------------------------------------------------

import { useEffect } from 'react'

export default function GlobalRootError({
  error, reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => { console.error('[global-error.tsx] caught:', error) }, [error])
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f8fafd', color: '#0f172a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ background: 'white', borderRadius: 16, padding: 32, maxWidth: 480, width: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', color: '#000e2f' }}>Something went seriously wrong</h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 16px', lineHeight: 1.5 }}>
            The whole page failed to load. Please try refreshing — if the problem persists, email <a style={{ color: '#1d49a7' }} href="mailto:hello@thestepsfoundation.com">hello@thestepsfoundation.com</a>{error.digest ? <> and quote reference <code>{error.digest}</code></> : null}.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ padding: '8px 16px', background: '#1d49a7', color: 'white', borderRadius: 12, border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
