'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    // Supabase client automatically handles the hash fragment
    // Just wait for session to be established then redirect
    const handleCallback = async () => {
      const { data: { session }, error } = await supabase.auth.getSession()
      
      if (session) {
        router.push('/')
      } else if (error) {
        console.error('Auth callback error:', error)
        router.push('/login?error=auth_failed')
      } else {
        // No session yet, wait a bit and try again
        setTimeout(async () => {
          const { data: { session: retrySession } } = await supabase.auth.getSession()
          if (retrySession) {
            router.push('/')
          } else {
            router.push('/login?error=auth_failed')
          }
        }, 1000)
      }
    }

    handleCallback()
  }, [router])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex items-center gap-3">
        <svg className="animate-spin h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-gray-600">Signing you in...</span>
      </div>
    </div>
  )
}
