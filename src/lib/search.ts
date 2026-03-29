import { embedText } from './embed.js'

export interface SearchResult {
  name: string
  package_slug: string
  version: string
  description: string | null
  score: number
  star_count: number
  download_count: number
  tags: string[]
  deprecated: boolean
  deprecation_message: string | null
  verified: boolean
  package_type: string
}

interface RrfItem { name: string; package_slug?: string; [key: string]: unknown }

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

export async function hybridSearch(query: string, limit = 20, type?: 'script' | 'library'): Promise<SearchResult[]> {
  const { supabase } = await import('./supabase.js')

  // Full-text search
  let ftsQuery = supabase
    .from('package_versions')
    .select('package_name, version, description, package_type')
    .textSearch('fts', query, { type: 'plain', config: 'english' })
    .order('published_at', { ascending: false })
    .limit(limit)
  if (type) ftsQuery = ftsQuery.eq('package_type', type)
  const { data: ftsRows } = await ftsQuery

  const ftsDeduped = dedupeLatest(ftsRows ?? [])

  // Semantic search (best-effort — skipped if embedding fails)
  let semDeduped: typeof ftsDeduped = []
  const embedding = await embedText(query, 'query')
  if (embedding) {
    const { data: semRows } = await supabase.rpc('match_package_versions', {
      query_embedding: embedding,
      match_count: limit,
    })
    let semFiltered = semRows ?? []
    if (type) semFiltered = semFiltered.filter((r: Record<string, unknown>) => r.package_type === type)
    semDeduped = dedupeLatest(semFiltered)
  }

  // Collect all unique package names
  const allNames = [...new Set([
    ...ftsDeduped.map(r => r.package_name),
    ...semDeduped.map(r => r.package_name)
  ])]

  // Fetch owner info to construct full slugs
  let ownerMap = new Map<string, string>()
  if (allNames.length > 0) {
    const { data: pkgRows } = await supabase
      .from('packages')
      .select('name, owner_slug')
      .in('name', allNames)
    ownerMap = new Map(pkgRows?.map(p => [p.name, p.owner_slug]) ?? [])
  }

  const merged = rrfMerge(
    ftsDeduped.map(r => ({ name: r.package_name, package_slug: `${ownerMap.get(r.package_name) ?? ''}/${r.package_name}`, version: r.version, description: r.description, package_type: r.package_type })),
    semDeduped.map(r => ({ name: r.package_name, package_slug: `${ownerMap.get(r.package_name) ?? ''}/${r.package_name}`, version: r.version, description: r.description, package_type: (r as Record<string, unknown>).package_type })),
  )

  const topNames = merged.slice(0, limit).map(r => r.name as string)

  // Fetch star_count from packages (denormalized column)
  let starMap = new Map<string, number>()
  if (topNames.length > 0) {
    const { data: starRows } = await supabase
      .from('packages')
      .select('name, star_count')
      .in('name', topNames)
    starMap = new Map(starRows?.map(r => [r.name, r.star_count ?? 0]) ?? [])
  }

  // Fetch total download_count across all versions for each package
  let dlMap = new Map<string, number>()
  if (topNames.length > 0) {
    const { data: dlRows } = await supabase
      .from('package_versions')
      .select('package_name, download_count')
      .in('package_name', topNames)
    const dlSum = new Map<string, number>()
    for (const row of dlRows ?? []) {
      dlSum.set(row.package_name, (dlSum.get(row.package_name) ?? 0) + (row.download_count ?? 0))
    }
    dlMap = dlSum
  }

  // Fetch tags for each package
  let tagsMap = new Map<string, string[]>()
  if (topNames.length > 0) {
    const { data: tagRows } = await supabase
      .from('package_tags')
      .select('package_name, tag')
      .in('package_name', topNames)
    const tagsByPkg = new Map<string, string[]>()
    for (const row of tagRows ?? []) {
      if (!tagsByPkg.has(row.package_name)) tagsByPkg.set(row.package_name, [])
      tagsByPkg.get(row.package_name)!.push(row.tag)
    }
    tagsMap = tagsByPkg
  }

  // Fetch deprecation status for each package
  let deprecationMap = new Map<string, { deprecated: boolean; deprecation_message: string | null }>()
  if (topNames.length > 0) {
    const { data: deprecRows } = await supabase
      .from('packages')
      .select('name, deprecated, deprecation_message')
      .in('name', topNames)
    for (const row of deprecRows ?? []) {
      deprecationMap.set(row.name, {
        deprecated: row.deprecated ?? false,
        deprecation_message: row.deprecation_message ?? null,
      })
    }
  }

  // Fetch verified status for each package
  let verifiedMap = new Map<string, boolean>()
  if (topNames.length > 0) {
    const { data: verifiedRows } = await supabase
      .from('packages')
      .select('name, verified')
      .in('name', topNames)
    for (const row of verifiedRows ?? []) {
      verifiedMap.set(row.name, row.verified ?? false)
    }
  }

  return merged.slice(0, limit).map(r => ({
    name: r.name as string,
    package_slug: r.package_slug as string,
    version: (r.version as string) ?? '',
    description: (r.description as string | null) ?? null,
    score: r.score,
    star_count: starMap.get(r.name as string) ?? 0,
    download_count: dlMap.get(r.name as string) ?? 0,
    tags: tagsMap.get(r.name as string) ?? [],
    deprecated: deprecationMap.get(r.name as string)?.deprecated ?? false,
    deprecation_message: deprecationMap.get(r.name as string)?.deprecation_message ?? null,
    verified: verifiedMap.get(r.name as string) ?? false,
    package_type: (r.package_type as string) ?? 'script',
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
