import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Apply — The Steps Foundation',
  description: 'Apply for Steps Foundation events and opportunities.',
}

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-indigo-50">
      {children}
    </div>
  )
}
