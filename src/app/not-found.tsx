import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-w-md w-full text-center">
        <p className="text-xs uppercase tracking-wider text-steps-blue-600 font-semibold mb-2">Error 404</p>
        <h1 className="font-display text-3xl font-bold text-steps-dark mb-2">Page not found</h1>
        <p className="text-sm text-slate-600 mb-6">
          The link you followed doesn&apos;t lead anywhere — it may have moved, or never existed.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Link
            href="/my"
            className="px-4 py-2 bg-steps-blue-600 text-white text-sm font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150"
          >
            Go to Student Hub
          </Link>
          <Link
            href="https://thestepsfoundation.com"
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors"
          >
            Main website
          </Link>
        </div>
      </div>
    </div>
  )
}
