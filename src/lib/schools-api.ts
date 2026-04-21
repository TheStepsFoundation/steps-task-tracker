import { supabase } from './supabase'

export type School = {
  id: string
  urn: number
  name: string
  town: string | null
  postcode: string | null
  phase: string | null
  type_group: string | null
  local_authority: string | null
  similarity?: number
}

/**
 * Top-N fuzzy matches by trigram similarity on schools.name.
 * Backed by the search_schools Postgres function — the index does the work.
 */
export async function searchSchools(q: string, limit = 15): Promise<School[]> {
  const trimmed = q.trim()
  if (!trimmed) return []
  const { data, error } = await supabase.rpc('search_schools', { q: trimmed, lim: limit })
  if (error) throw error
  return (data ?? []) as School[]
}

export async function fetchSchoolById(id: string): Promise<School | null> {
  const { data, error } = await supabase
    .from('schools')
    .select('id,urn,name,town,postcode,phase,type_group,local_authority')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as School) ?? null
}


/**
 * Pulls a random secondary-age school from the GIAS register. Used by the
 * admin 'Add test student' randomiser so dummy rows get a plausible real
 * school attached instead of a made-up free-text string.
 *
 * Uses two quick queries (count, then range at a random offset) because
 * PostgREST can't do ORDER BY random() directly, and we don't want to
 * pull the whole table. Ordered by id for determinism given a fixed offset.
 */
export async function fetchRandomSchool(): Promise<School | null> {
  const phases = ['Secondary', '16 plus', 'All-through']
  const { count, error: ce } = await supabase
    .from('schools')
    .select('id', { count: 'exact', head: true })
    .in('phase', phases)
    .is('deleted_at', null)
  if (ce || !count) return null
  const offset = Math.floor(Math.random() * count)
  const { data, error } = await supabase
    .from('schools')
    .select('id,urn,name,town,postcode,phase,type_group,local_authority')
    .in('phase', phases)
    .is('deleted_at', null)
    .order('id')
    .range(offset, offset)
  if (error) return null
  return ((data ?? [])[0] as School) ?? null
}
