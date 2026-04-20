// Helpers for rendering event-facing fields with privacy rules.
//
// Full street addresses must only be visible to accepted applicants or
// team members. Everyone else (prospective applicants, submitted/waitlist/
// rejected students) sees the public `location` label.

type EventLocationFields = {
  location: string | null
  location_full: string | null
}

/**
 * Returns the location string that should be rendered to a given viewer.
 *
 * - `isPrivileged=true` (accepted student OR team member) → full address if set,
 *   otherwise fall back to the public label.
 * - `isPrivileged=false` (everyone else) → public label only.
 *
 * Passing `null`/`undefined` for the event fields is safe; returns null.
 */
export function getDisplayLocation(
  event: EventLocationFields | null | undefined,
  isPrivileged: boolean,
): string | null {
  if (!event) return null
  if (isPrivileged && event.location_full) return event.location_full
  return event.location ?? null
}

/**
 * True if the viewer should see the full street address for this event.
 * Accepted applicants OR team members.
 */
export function canSeeFullAddress(
  applicationStatus: string | null | undefined,
  isTeamMember: boolean,
): boolean {
  if (isTeamMember) return true
  return applicationStatus === 'accepted'
}
