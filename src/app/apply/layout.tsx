import type { Metadata } from 'next'
import { TopNav } from '@/components/TopNav'

export const metadata: Metadata = {
  title: 'Apply — The Steps Foundation',
  description: 'Apply for Steps Foundation events and opportunities.',
}

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-steps-blue-50 via-white to-steps-blue-50">
      <TopNav homeHref="/my" />
      {children}
    </div>
  )
}
