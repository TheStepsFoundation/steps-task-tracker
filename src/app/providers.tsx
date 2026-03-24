'use client'

import { AuthProvider } from '@/lib/auth-provider'
import { DataProvider } from '@/lib/data-provider'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>{children}</DataProvider>
    </AuthProvider>
  )
}
