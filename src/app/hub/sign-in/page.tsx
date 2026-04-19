'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { sendOtp, verifyOtp, signInWithPassword, getExistingSession } from '@/lib/apply-api'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// Hub Sign-In — lightweight auth page that redirects to /hub on success.
// Supports email+password (returning students) and OTP (first-time / forgot).
// ---------------------------------------------------------------------------

type Step = 'email' | 'otp' | 'redirecting'

export default function HubSignInPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [step, setStep] = useState<Step>('email')
  const [useOtp, setUseOtp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Check for existing session on mount
  useState(() => {
    getExistingSession().then(s => {
      if (s?.email) router.replace('/hub')
    })
  })

  // --- Password sign-in ---
  const handlePasswordSignIn = async () => {
    setError(null)
    setLoading(true)
    const { error: err } = await signInWithPassword(email, password)
    setLoading(false)
    if (err) {
      // If "Invalid login credentials", suggest OTP
      if (err.toLowerCase().includes('invalid')) {
        setError('Incorrect password. Try signing in with a verification code instead.')
      } else {
        setError(err)
      }
      return
    }
    setStep('redirecting')
    router.replace('/hub')
  }

  // --- OTP flow ---
  const handleSendOtp = async () => {
    setError(null)
    setLoading(true)
    const { error: err } = await sendOtp(email)
    setLoading(false)
    if (err) { setError(err); return }
    setStep('otp')
  }

  const handleVerifyOtp = async () => {
    setError(null)
    setLoading(true)
    const { error: err } = await verifyOtp(email, otpCode)
    setLoading(false)
    if (err) { setError(err); return }
    setStep('redirecting')
    router.replace('/hub')
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (step === 'redirecting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 animate-pulse">Signing you in…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Student Hub</h1>
          <p className="mt-2 text-gray-600">
            Sign in to view your applications and account details.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
          {/* Email field (always shown) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              placeholder="your@email.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(null) }}
              disabled={step === 'otp'}
              onKeyDown={e => {
                if (e.key === 'Enter' && email.trim()) {
                  if (useOtp) handleSendOtp()
                  else handlePasswordSignIn()
                }
              }}
            />
          </div>

          {/* ---- Password mode ---- */}
          {step === 'email' && !useOtp && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') handlePasswordSignIn() }}
                />
              </div>

              <button
                onClick={handlePasswordSignIn}
                disabled={loading || !email.trim() || !password}
                className="w-full bg-indigo-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>

              <button
                type="button"
                onClick={() => { setUseOtp(true); setError(null) }}
                className="w-full text-sm text-indigo-600 hover:text-indigo-800 py-1"
              >
                Use a verification code instead
              </button>
            </>
          )}

          {/* ---- OTP mode: send code ---- */}
          {step === 'email' && useOtp && (
            <>
              <button
                onClick={handleSendOtp}
                disabled={loading || !email.trim()}
                className="w-full bg-indigo-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Sending…' : 'Send verification code'}
              </button>

              <button
                type="button"
                onClick={() => { setUseOtp(false); setError(null) }}
                className="w-full text-sm text-indigo-600 hover:text-indigo-800 py-1"
              >
                Sign in with password instead
              </button>
            </>
          )}

          {/* ---- OTP mode: verify code ---- */}
          {step === 'otp' && (
            <>
              <p className="text-sm text-gray-600">
                We sent a 6-digit code to <span className="font-medium">{email}</span>.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Verification code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tracking-widest text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  placeholder="000000"
                  value={otpCode}
                  onChange={e => { setOtpCode(e.target.value.replace(/\D/g, '')); setError(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') handleVerifyOtp() }}
                />
              </div>

              <button
                onClick={handleVerifyOtp}
                disabled={loading || otpCode.length < 6}
                className="w-full bg-indigo-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Verifying…' : 'Verify & sign in'}
              </button>

              <button
                type="button"
                onClick={() => { setStep('email'); setOtpCode(''); setError(null) }}
                className="w-full text-sm text-gray-500 hover:text-gray-700 py-1"
              >
                ← Back
              </button>
            </>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer links */}
        <div className="mt-6 text-center text-sm text-gray-500">
          <Link href="https://thestepsfoundation.com" className="hover:text-indigo-600 transition-colors">
            ← Back to The Steps Foundation
          </Link>
        </div>
      </div>
    </div>
  )
}
