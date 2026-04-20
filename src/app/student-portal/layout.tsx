import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Student Portal — The Steps Foundation',
  description: 'Access your Steps Foundation applications and profile.',
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-indigo-50">
      {children}
    </div>
  )
}
