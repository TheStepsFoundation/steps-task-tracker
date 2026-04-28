import type { Metadata } from 'next'

// Metadata-only layout — student-side hub pages each render their own
// TopNav and chrome, so this exists purely to override the root
// "Steps Foundation Intranet" tab title with something meaningful for
// students. Subroutes (sign-in, events/[id]) override with their own
// layouts where useful.
export const metadata: Metadata = {
  title: 'Student Hub — The Steps Foundation',
  description: 'Your applications, events and profile at The Steps Foundation.',
}

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
