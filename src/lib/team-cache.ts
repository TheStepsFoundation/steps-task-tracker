/**
 * Persistent cache of the current user's team_members row.
 *
 * WHY: the admin gate used to re-query team_members on every page load. Under
 * a flaky or cold Supabase connection that query would time out, the retry
 * loop would give up, and the user got bounced to /login mid-work.
 *
 * Now we cache the row in localStorage keyed by auth_uuid. On page load the
 * AuthProvider reads this synchronously and renders the intranet straight
 * away; a network check still runs in the background and only acts on a
 * *conclusive* not_member response (never on unknowns).
 *
 * Security: the cache is keyed by auth_uuid so switching users wipes it. A
 * revoked admin loses access on the next background verify that comes back
 * conclusively not_member — typically within one page load.
 */

const KEY = 'tsf_intranet_team_cache_v1'
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000  // 7 days

export type CachedTeamMember = {
  auth_uuid: string
  id: number
  name: string
  role: string
  email: string
}

type CacheEnvelope = {
  auth_uuid: string
  cached_at: number  // Date.now() when we last wrote this
  row: CachedTeamMember
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

/**
 * Read the cached row for a given auth_uuid. Returns null if the cache is
 * empty, belongs to a different user, or has aged out.
 */
export function readTeamCache(authUuid: string | undefined | null): CachedTeamMember | null {
  if (!isBrowser() || !authUuid) return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const env = JSON.parse(raw) as CacheEnvelope
    if (!env || env.auth_uuid !== authUuid) return null
    if (typeof env.cached_at !== 'number') return null
    if (Date.now() - env.cached_at > CACHE_TTL_MS) return null
    return env.row
  } catch {
    return null
  }
}

/** Write a row to the cache, stamped with now. */
export function writeTeamCache(row: CachedTeamMember): void {
  if (!isBrowser()) return
  try {
    const env: CacheEnvelope = { auth_uuid: row.auth_uuid, cached_at: Date.now(), row }
    window.localStorage.setItem(KEY, JSON.stringify(env))
  } catch {
    // localStorage quota exceeded etc. — best-effort; we'll just re-check next time.
  }
}

/** Drop the cache — called on sign-out or conclusive not_member. */
export function clearTeamCache(): void {
  if (!isBrowser()) return
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // noop
  }
}

/**
 * How stale the current cache is, in ms. Infinity if no cache. Used by the
 * AuthProvider to decide whether to kick off a background verify.
 */
export function cacheAgeMs(authUuid: string | undefined | null): number {
  if (!isBrowser() || !authUuid) return Infinity
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return Infinity
    const env = JSON.parse(raw) as CacheEnvelope
    if (!env || env.auth_uuid !== authUuid || typeof env.cached_at !== 'number') return Infinity
    return Date.now() - env.cached_at
  } catch {
    return Infinity
  }
}
