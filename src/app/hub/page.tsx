'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-provider'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { TopNav } from '@/components/TopNav'

const modules = [
  {
    name: 'Task Tracker',
    description: 'Manage workflows, assign tasks, and track progress across all events and campaigns.',
    href: '/',
    accent: 'from-steps-blue-600 to-steps-blue-500',
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    name: 'Students',
    description: 'Student database, applications, school matching, and eligibility tracking.',
    href: '/students',
    accent: 'from-steps-berry to-steps-sunrise',
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
      </svg>
    ),
  },
]

export default function HubPage() {
  const { user, loading, signOut, isTeamMember, teamMember } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    console.log('[hub] mounted: user=', !!user, 'isTeamMember=', isTeamMember, 'path=', typeof window!=='undefined'?window.location.pathname:'ssr')
    if (!user || !isTeamMember) {
      console.log('[hub] redirecting to /login')
      router.push('/login')
    }
  }, [user, loading, isTeamMember, router])

  if (loading || !user || !isTeamMember) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-500">Loading…</div>
      </div>
    )
  }

  const displayName = teamMember?.name || user.email?.split('@')[0] || 'Unknown'
  const firstName = displayName.split(' ')[0]

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <TopNav>
        <span className="hidden sm:block text-sm text-slate-600">{displayName}</span>
        <button
          onClick={() => signOut().then(() => router.push('/login'))}
          className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 transition"
        >
          Sign out
        </button>
      </TopNav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="mb-10">
          <h1 className="font-display text-3xl sm:text-4xl font-black text-steps-dark tracking-tight">
            Welcome back, {firstName}
          </h1>
          <p className="mt-2 text-slate-600">
            What would you like to work on today?
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {modules.map((mod) => (
            <Link
              key={mod.name}
              href={mod.href}
              className="group relative overflow-hidden bg-white rounded-2xl border border-slate-100 p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:border-steps-blue-200"
            >
              <div className={`bg-gradient-to-br ${mod.accent} w-12 h-12 rounded-xl flex items-center justify-center text-white mb-4 shadow-sm`}>
                {mod.icon}
              </div>
              <h2 className="font-display text-xl font-bold text-steps-dark mb-1">
                {mod.name}
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                {mod.description}
              </p>
              <div className="absolute top-6 right-6 text-slate-300 group-hover:text-steps-blue-600 group-hover:translate-x-1 transition-all">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-steps-blue-600 to-steps-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          ))}
        </div>

        <p className="text-center text-xs text-slate-400 mt-16 tracking-wide uppercase">
          <em className="not-italic">Virtus non origo</em> &nbsp;&middot;&nbsp; Character, not origin
        </p>
      </main>
    </div>
  )
}
