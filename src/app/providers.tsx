'use client'

import { AuthProvider } from '@/lib/auth-provider'
import { DataProvider } from '@/lib/data-provider'
import { ThemeProvider } from '@/lib/theme-provider'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DataProvider>{children}</DataProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
