import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign in — Student Hub',
  description: 'Sign in to view your Steps Foundation applications and event details.',
}

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
