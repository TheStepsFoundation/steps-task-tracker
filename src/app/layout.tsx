import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Steps Foundation Intranet',
  description: 'Internal tools for The Steps Foundation team',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="font-sans text-slate-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
