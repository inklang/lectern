import { embedText } from './embed.js'

export interface SearchResult {
  name: string
  version: string
  description: string | null
  score: number
}

interface RrfItem { name: string; [key: string]: unknown }

export function rrfMerge(fts: RrfItem[], semantic: RrfItem[], k = 60): (RrfItem & { score: number })[] {
  const scores = new Map<string, number>()
  const items = new Map<string, RrfItem>()

  fts.forEach((item, i) => {
    const s = (scores.get(item.name) ?? 0) + 1 / (k + i + 1)
    scores.set(item.name, s)
    items.set(item.name, item)
  })

  semantic.forEach((item, i) => {
    const s = (scores.get(item.name) ?? 0) + 1 / (k + i + 1)
    scores.set(item.name, s)
    if (!items.has(item.name)) items.set(item.name, item)
  })

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, score]) => ({ ...items.get(name)!, name, score }))
}

export async function hybridSearch(query: string, limit = 20): Promise<SearchResult[]> {
  const { supabase } = await import('./supabase.js')

  // Full-text search
  const { data: ftsRows } = await supabase
    .from('package_versions')
    .select('package_name, version, description')
    .textSearch('fts', query, { type: 'plain', config: 'english' })
    .order('published_at', { ascending: false })
    .limit(limit)

  const ftsDeduped = dedupeLatest(ftsRows ?? [])

  // Semantic search (best-effort — skipped if embedding fails)
  let semDeduped: typeof ftsDeduped = []
  const embedding = await embedText(query, 'query')
  if (embedding) {
    const { data: semRows } = await supabase.rpc('match_package_versions', {
      query_embedding: embedding,
      match_count: limit,
    })
    semDeduped = dedupeLatest(semRows ?? [])
  }

  const merged = rrfMerge(
    ftsDeduped.map(r => ({ name: r.package_name, version: r.version, description: r.description })),
    semDeduped.map(r => ({ name: r.package_name, version: r.version, description: r.description })),
  )

  return merged.slice(0, limit).map(r => ({
    name: r.name as string,
    version: r.version as string,
    description: r.description as string | null,
    score: r.score,
  }))
}

// Keep only the latest version per package name (rows ordered newest first)
function dedupeLatest<T extends { package_name: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter(r => {
    if (seen.has(r.package_name)) return false
    seen.add(r.package_name)
    return true
  })
}
