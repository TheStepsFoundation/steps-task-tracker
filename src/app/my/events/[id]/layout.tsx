import type { Metadata } from 'next'

// Static title — per-event dynamic titles would require an extra DB fetch
// per render and aren't worth the latency. The route is hit infrequently
// enough that a generic "Event" tab title is fine.
export const metadata: Metadata = {
  title: 'Your event — Student Hub',
  description: 'Event details, application status and check-in for your Steps Foundation event.',
}

export default function EventLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
