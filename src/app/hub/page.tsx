'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-provider'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

const modules = [
  {
    name: 'Task Tracker',
    description: 'Manage workflows, assign tasks, and track progress across all events and campaigns.',
    href: '/',
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
    color: 'bg-purple-600',
    hoverColor: 'hover:ring-purple-300 dark:hover:ring-purple-700',
  },
  {
    name: 'Students',
    description: 'Student database, applications, school matching, and eligibility tracking.',
    href: '/students',
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
      </svg>
    ),
    color: 'bg-indigo-600',
    hoverColor: 'hover:ring-indigo-300 dark:hover:ring-indigo-700',
  },
]

export default function HubPage() {
  const { user, loading, signOut, isTeamMember, teamMember } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!user || !isTeamMember) {
      router.push('/login')
    }
  }, [user, loading, isTeamMember, router])

  if (loading || !user || !isTeamMember) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-gray-500 dark:text-gray-400">Loading…</div>
      </div>
    )
  }

  const displayName = teamMember?.name || user.email?.split('@')[0] || 'Unknown'
  const firstName = displayName.split(' ')[0]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            Steps <span className="text-purple-600 dark:text-purple-400">Foundation</span>
          </span>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-gray-600 dark:text-gray-400">{displayName}</span>
            <button
              onClick={() => signOut().then(() => router.push('/login'))}
              className="text-sm px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
            Welcome back, {firstName}
          </h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            What would you like to work on?
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {modules.map((mod) => (
            <Link
              key={mod.name}
              href={mod.href}
              className={`group relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 transition-all hover:shadow-lg hover:ring-2 ${mod.hoverColor}`}
            >
              <div className={`${mod.color} w-12 h-12 rounded-xl flex items-center justify-center text-white mb-4`}>
                {mod.icon}
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                {mod.name}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                {mod.description}
              </p>
              <div className="absolute top-6 right-6 text-gray-300 dark:text-gray-600 group-hover:text-gray-400 dark:group-hover:text-gray-500 transition">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-gray-600 mt-12">
          <em>Virtus non origo</em> — Character, not origin
        </p>
      </main>
    </div>
  )
}
