import { supabase } from './supabase.js'

export interface PackageVersion {
  package_slug: string
  version: string
  description: string | null
  readme: string | null
  author: string | null
  license: string | null
  dependencies: Record<string, string>
  tarball_url: string
  published_at: string
  download_count?: number
  targets?: string[]
  package_type?: string
}

export interface PackageRow {
  name: string
  slug: string
  display_name: string
  owner_slug: string
  owner_id: string
  owner_type: string
  created_at: string
}

// Returns all packages with all their versions (for /index.json)
// Key is the slug (e.g., "owner/package")
export async function listAllPackages(): Promise<Record<string, Record<string, PackageVersion>>> {
  const { data, error } = await supabase
    .from('package_versions')
    .select('*')
    .order('published_at', { ascending: false })
  if (error) throw error

  const result: Record<string, Record<string, PackageVersion>> = {}
  for (const row of data ?? []) {
    if (!result[row.package_slug]) result[row.package_slug] = {}
    result[row.package_slug][row.version] = row
  }
  return result
}

// Returns all versions for a single package, sorted newest first
export async function getPackageVersions(slug: string): Promise<PackageVersion[]> {
  const { data, error } = await supabase
    .from('package_versions')
    .select('*')
    .eq('package_slug', slug)
    .order('published_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Returns the owner fingerprint (user_id) for a package, or null
export async function getPackageOwner(slug: string): Promise<string | null> {
  const { data } = await supabase
    .from('packages')
    .select('owner_id')
    .eq('slug', slug)
    .single()
  return data?.owner_id ?? null
}

// Resolves a bare package name to its full slug (e.g., "ink.mobs" -> "owner/ink.mobs")
// Returns null if the package is not found
export async function resolvePackageSlug(bareName: string): Promise<string | null> {
  const { data } = await supabase
    .from('packages')
    .select('slug')
    .eq('name', bareName)
    .single()
  return data?.slug ?? null
}

// Batch version of resolvePackageSlug — resolves multiple bare names at once
// Returns a map of bareName -> fullSlug (or null if not found)
export async function resolvePackageSlugs(bareNames: string[]): Promise<Map<string, string | null>> {
  if (bareNames.length === 0) return new Map()

  const { data, error } = await supabase
    .from('packages')
    .select('name, slug')
    .in('name', bareNames)

  if (error) throw error

  const result = new Map<string, string | null>()
  // Initialize all names as not found
  for (const name of bareNames) result.set(name, null)
  // Fill in found ones
  for (const row of data ?? []) {
    result.set(row.name, row.slug)
  }
  return result
}

// Registers a new package (first publish)
export async function createPackage(slug: string, displayName: string, ownerSlug: string, ownerId: string, ownerType: 'user' | 'org' = 'user'): Promise<void> {
  const { error } = await supabase
    .from('packages')
    .insert({ slug, name: displayName, owner_slug: ownerSlug, owner_id: ownerId, owner_type: ownerType })
  if (error) throw error
}

// Inserts a new package version row
export async function insertVersion(version: Omit<PackageVersion, 'published_at'> & { embedding?: number[] | null }): Promise<void> {
  const { error } = await supabase
    .from('package_versions')
    .insert({ ...version, package_type: version.package_type ?? 'script' })
  if (error) throw error
}

// Returns true if slug@version already exists
export async function versionExists(slug: string, version: string): Promise<boolean> {
  const { data } = await supabase
    .from('package_versions')
    .select('version')
    .eq('package_slug', slug)
    .eq('version', version)
    .single()
  return !!data
}

export interface PackageDependentsResult {
  package_slug: string
  version: string
  dep_version: string | null
}

// Returns packages/versions that depend on the given package name (short name, not slug)
// The JSONB column stores deps as {"pkgName": "versionRange", ...}
// Uses GIN index via RPC function: WHERE dependencies @> jsonb_build_object($1, '')
export async function getPackageDependentsFast(pkgName: string): Promise<PackageDependentsResult[]> {
  const { data, error } = await supabase.rpc('get_package_dependents', { pkg_name: pkgName })
  if (error) throw error
  return (data as PackageDependentsResult[]) ?? []
}

// Legacy function kept for backward compatibility — uses GIN index via RPC
export async function getPackageDependents(pkgName: string): Promise<PackageDependentsResult[]> {
  return getPackageDependentsFast(pkgName)
}

// Returns the dependency tree for a specific version
export async function getVersionDependencies(slug: string, version: string): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('package_versions')
    .select('dependencies')
    .eq('package_slug', slug)
    .eq('version', version)
    .single()
  if (error) throw error
  return (data?.dependencies as Record<string, string>) ?? {}
}

// Logs a download event and increments the version's download_count.
// authHeader is optional; if provided and resolves to a user, logs the user_id.
// country is an ISO 3166-1 alpha-2 code (e.g. "US") from CF-IPCountry header.
// referrer is normalized from the Referer header (stripped of protocol, max 500 chars).
export async function logDownload(
  name: string,
  version: string,
  authHeader: string | null,
  country?: string,
  referrer?: string,
): Promise<void> {
  const { resolveAuth } = await import('./tokens.js')
  let userId: string | null = null
  if (authHeader) {
    userId = await resolveAuth(authHeader)
  }

  // Normalize referrer: strip protocol, default to "direct", truncate to 500 chars
  const normalizedReferrer = referrer
    ? referrer.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 500) || 'direct'
    : 'direct'

  // Insert log entry
  await supabase.from('download_logs').insert({
    package_name: name,
    version,
    user_id: userId ?? undefined,
    country: country ?? null,
    referrer: normalizedReferrer,
  })

  // Atomically increment the counter on package_versions
  await supabase.rpc('increment_download_count', { pkg_name: name, ver: version })
}

// ─── Download Analytics ─────────────────────────────────────────────────────────

export interface TimelineResult {
  timeline: { date: string; count: number }[]
  total: number
  periodDownloads: number
}

export interface VersionsResult {
  versions: { version: string; count: number; percentage: number }[]
}

export interface ReferrersResult {
  referrers: { referrer: string; count: number }[]
}

export interface GeoResult {
  geo: { country: string; count: number }[]
}

// Returns analytics data for a specific dimension and time range.
// dimension: 'timeline' | 'versions' | 'referrers' | 'geo'
// days: number or 'all' for no time limit
export async function getDownloadAnalytics(
  packageName: string,
  dimension: 'timeline' | 'versions' | 'referrers' | 'geo',
  days: number | 'all',
): Promise<TimelineResult | VersionsResult | ReferrersResult | GeoResult> {
  if (dimension === 'timeline') {
    // Use the existing getDownloadTimeline but include total and period sums
    const timeline = await getDownloadTimeline(packageName, days === 'all' ? 9999 : days)
    const total = timeline.reduce((sum, d) => sum + d.count, 0)
    const periodDownloads = days === 'all' ? total : timeline.reduce((sum, d) => sum + d.count, 0)
    return { timeline, total, periodDownloads }
  }

  if (dimension === 'versions') {
    let query = supabase
      .from('download_logs')
      .select('version')
      .eq('package_name', packageName)

    if (days !== 'all') {
      const since = new Date()
      since.setDate(since.getDate() - days)
      query = query.gte('downloaded_at', since.toISOString())
    }

    const { data, error } = await query
    if (error) throw error

    const counts: Record<string, number> = {}
    for (const row of data ?? []) {
      counts[row.version] = (counts[row.version] ?? 0) + 1
    }

    const total = Object.values(counts).reduce((s, c) => s + c, 0)
    const versions = Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([version, count]) => ({
        version,
        count,
        percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      }))

    return { versions }
  }

  if (dimension === 'referrers') {
    let query = supabase
      .from('download_logs')
      .select('referrer')
      .eq('package_name', packageName)
      .not('referrer', 'is', null)

    if (days !== 'all') {
      const since = new Date()
      since.setDate(since.getDate() - days)
      query = query.gte('downloaded_at', since.toISOString())
    }

    const { data, error } = await query
    if (error) throw error

    const counts: Record<string, number> = {}
    for (const row of data ?? []) {
      const ref = (row.referrer as string) || 'direct'
      counts[ref] = (counts[ref] ?? 0) + 1
    }

    const referrers = Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([referrer, count]) => ({ referrer, count }))

    return { referrers }
  }

  // dimension === 'geo'
  let query = supabase
    .from('download_logs')
    .select('country')
    .eq('package_name', packageName)
    .not('country', 'is', null)

  if (days !== 'all') {
    const since = new Date()
    since.setDate(since.getDate() - days)
    query = query.gte('downloaded_at', since.toISOString())
  }

  const { data, error } = await query
  if (error) throw error

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const country = (row.country as string) || 'XX'
    counts[country] = (counts[country] ?? 0) + 1
  }

  const geo = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([country, count]) => ({ country, count }))

  return { geo }
}

// Returns download stats for a package: total (from version rows), last7d, last30d (from logs)
export async function getPackageStats(name: string): Promise<{ total: number; last7d: number; last30d: number }> {
  const { data, error } = await supabase.rpc('get_package_stats', { pkg_name: name })
  if (error) throw error
  return data as { total: number; last7d: number; last30d: number }
}

// Returns daily download counts for the last N days for a single package.
// Returns array sorted oldest → newest.
export async function getDownloadTimeline(
  packageName: string,
  days = 30
): Promise<{ date: string; count: number }[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await supabase
    .from('download_logs')
    .select('downloaded_at')
    .eq('package_name', packageName)
    .gte('downloaded_at', since.toISOString())

  if (error) throw error

  // Group by date
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const date = row.downloaded_at.slice(0, 10) // YYYY-MM-DD
    counts[date] = (counts[date] ?? 0) + 1
  }

  // Fill in all days in range
  const result: { date: string; count: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    result.push({ date: dateStr, count: counts[dateStr] ?? 0 })
  }
  return result
}

// Batch version: fetches timelines for multiple packages in one query.
export async function getDownloadTimelines(
  packages: string[],
  days = 30
): Promise<Record<string, { date: string; count: number }[]>> {
  if (packages.length === 0) return {}

  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await supabase
    .from('download_logs')
    .select('package_name, downloaded_at')
    .in('package_name', packages)
    .gte('downloaded_at', since.toISOString())

  if (error) throw error

  // Group by package_name + date
  const counts: Record<string, Record<string, number>> = {}
  for (const pkg of packages) counts[pkg] = {}
  for (const row of data ?? []) {
    const date = row.downloaded_at.slice(0, 10)
    if (counts[row.package_name]) {
      counts[row.package_name][date] = (counts[row.package_name][date] ?? 0) + 1
    }
  }

  // Build result with all days filled in for each package
  const result: Record<string, { date: string; count: number }[]> = {}
  for (const pkg of packages) {
    result[pkg] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      result[pkg].push({ date: dateStr, count: counts[pkg]?.[dateStr] ?? 0 })
    }
  }
  return result
}

export interface TrendingPackage {
  package_name: string
  package_slug: string
  download_count: number
  latest_version: string
  description: string | null
}

// Returns top N trending packages over the given window in days.
export async function getTrendingPackages(windowDays = 7, limitCount = 5): Promise<TrendingPackage[]> {
  const { data, error } = await supabase.rpc('get_trending_packages', {
    window_days: windowDays,
    limit_count: limitCount,
  })
  if (error) throw error
  const results = (data as Omit<TrendingPackage, 'package_slug'>[]) ?? []

  if (results.length === 0) return []

  // Fetch owner info to construct full slug
  const packageNames = results.map(r => r.package_name)
  const { data: pkgRows } = await supabase
    .from('packages')
    .select('name, owner_slug')
    .in('name', packageNames)

  const ownerMap = new Map(pkgRows?.map(p => [p.name, p.owner_slug]) ?? [])

  return results.map(r => ({
    ...r,
    package_slug: `${ownerMap.get(r.package_name) ?? ''}/${r.package_name}`
  }))
}

// ─── Popularity Score ───────────────────────────────────────────────────────────

export interface PopularPackage {
  package_name: string
  package_slug: string
  popularity_score: number
  download_count: number
  star_count: number
  latest_version: string
  description: string | null
  created_at: string
}

// Get paginated popular packages (for browse page sort)
export async function getPopularPackages(
  limit = 20,
  offset = 0
): Promise<PopularPackage[]> {
  const { data, error } = await supabase.rpc('get_popular_packages', {
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  const results = (data as Omit<PopularPackage, 'package_slug'>[]) ?? []

  if (results.length === 0) return []

  // Fetch owner info to construct full slug
  const packageNames = results.map(r => r.package_name)
  const { data: pkgRows } = await supabase
    .from('packages')
    .select('name, owner_slug')
    .in('name', packageNames)

  const ownerMap = new Map(pkgRows?.map(p => [p.name, p.owner_slug]) ?? [])

  return results.map(r => ({
    ...r,
    package_slug: `${ownerMap.get(r.package_name) ?? ''}/${r.package_name}`
  }))
}

// Get score for a single package
export async function getPackageScore(name: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_package_score', {
    p_package_name: name,
  })
  if (error) throw error
  return (data as number) ?? 0
}

// Star/unstar (for future use)
export async function setPackageStar(
  packageName: string,
  starred: boolean
): Promise<void> {
  const { error } = await supabase.rpc('set_package_star', {
    p_package_name: packageName,
    p_starred: starred,
  })
  if (error) throw error
}

// ─── Tags ────────────────────────────────────────────────────────────────────

export interface TagWithCount {
  name: string
  package_count: number
}

export interface PackageTagResult {
  package_name: string
  version: string
  description: string | null
  published_at: string
}

// List all tags with package counts.
export async function listTags(): Promise<TagWithCount[]> {
  const { data, error } = await supabase.rpc('list_tags')
  if (error) throw error
  return (data as TagWithCount[]) ?? []
}

// Get tags for a specific package.
export async function getPackageTags(pkgName: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_package_tags', { pkg_name: pkgName })
  if (error) throw error
  return (data as { tag: string }[]).map(r => r.tag)
}

// Add a tag to a package. Creates the tag if it doesn't exist.
// Accepts slug (owner/package) and extracts short name for storage
export async function addPackageTag(slug: string, tag: string): Promise<void> {
  // Upsert the tag (idempotent)
  try {
    await supabase.from('tags').upsert({ name: tag })
  } catch {}
  // Extract short name from slug for storage (e.g., "owner/package" -> "package")
  const shortName = slug.includes('/') ? slug.split('/').pop()! : slug
  const { error } = await supabase.from('package_tags').insert({ package_name: shortName, tag })
  if (error) throw error
}

// Remove a tag from a package.
export async function removePackageTag(slug: string, tag: string): Promise<void> {
  // Extract short name from slug for storage
  const shortName = slug.includes('/') ? slug.split('/').pop()! : slug
  const { error } = await supabase
    .from('package_tags')
    .delete()
    .eq('package_name', shortName)
    .eq('tag', tag)
  if (error) throw error
}

// Get packages filtered by a specific tag.
export async function getPackagesByTag(
  tag: string,
  limit = 20,
  offset = 0
): Promise<PackageTagResult[]> {
  const { data, error } = await supabase.rpc('get_packages_by_tag', {
    p_tag: tag,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return (data as PackageTagResult[]) ?? []
}

// ─── Deprecation ─────────────────────────────────────────────────────────────

export interface PackageDeprecation {
  deprecated: boolean
  deprecation_message: string | null
  deprecated_at: string | null
  deprecated_by: string | null
}

// Returns deprecation info for a package
export async function getPackageDeprecation(name: string): Promise<PackageDeprecation | null> {
  const { data, error } = await supabase
    .from('packages')
    .select('deprecated, deprecation_message, deprecated_at, deprecated_by')
    .eq('name', name)
    .single()
  if (error) throw error
  if (!data) return null
  return {
    deprecated: data.deprecated ?? false,
    deprecation_message: data.deprecation_message ?? null,
    deprecated_at: data.deprecated_at ?? null,
    deprecated_by: data.deprecated_by ?? null,
  }
}

// Batch version: fetches deprecation info for multiple packages in one query
export async function getDeprecationsForPackages(names: string[]): Promise<Record<string, PackageDeprecation | null>> {
  if (names.length === 0) return {}

  const { data, error } = await supabase
    .from('packages')
    .select('name, deprecated, deprecation_message, deprecated_at, deprecated_by')
    .in('name', names)

  if (error) throw error

  const result: Record<string, PackageDeprecation | null> = {}
  for (const name of names) result[name] = null
  for (const row of data ?? []) {
    result[row.name] = {
      deprecated: row.deprecated ?? false,
      deprecation_message: row.deprecation_message ?? null,
      deprecated_at: row.deprecated_at ?? null,
      deprecated_by: row.deprecated_by ?? null,
    }
  }
  return result
}

// Sets the deprecation status of a package
export async function setPackageDeprecation(
  name: string,
  deprecated: boolean,
  message: string | null,
  userId: string
): Promise<void> {
  const updates: Record<string, unknown> = {
    deprecated,
    deprecated_by: deprecated ? userId : null,
    deprecated_at: deprecated ? new Date().toISOString() : null,
  }
  if (message !== undefined) {
    updates.deprecation_message = deprecated ? (message || null) : null
  }

  const { error } = await supabase
    .from('packages')
    .update(updates)
    .eq('name', name)
  if (error) throw error
}

// ─── Security Advisories ───────────────────────────────────────────────────────

export interface PackageAdvisory {
  id: string
  package_name: string
  advisory_id: string
  cve: string | null
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  affected_versions: string
  fixed_version: string | null
  advisory_url: string
  source: string
  fetched_at: string
  published_at: string | null
}

// Returns all advisories for a specific package
export async function getPackageAdvisories(pkgName: string): Promise<PackageAdvisory[]> {
  const { data, error } = await supabase
    .from('package_advisories')
    .select('*')
    .eq('package_name', pkgName)
    .order('severity', { ascending: false })
  if (error) throw error
  return (data as PackageAdvisory[]) ?? []
}

// Returns all advisories (paginated)
export async function getAllAdvisories(
  limitCount = 50,
  offsetCount = 0
): Promise<{ advisories: PackageAdvisory[]; total: number }> {
  const { data, error, count } = await supabase
    .from('package_advisories')
    .select('*', { count: 'exact' })
    .order('severity', { ascending: false })
    .range(offsetCount, offsetCount + limitCount - 1)
  if (error) throw error
  return {
    advisories: (data as PackageAdvisory[]) ?? [],
    total: count ?? 0,
  }
}

// Upserts an advisory for a package
export async function upsertAdvisory(
  advisory: Omit<PackageAdvisory, 'id' | 'fetched_at'>
): Promise<void> {
  const { error } = await supabase
    .from('package_advisories')
    .upsert(
      { ...advisory, fetched_at: new Date().toISOString() },
      { onConflict: 'package_name,advisory_id' }
    )
  if (error) throw error
}

// ─── Package Stars ─────────────────────────────────────────────────────────────

// Star a package for a user. Idempotent (no error if already starred).
// slug is the fully-qualified package slug (e.g., "owner/package_name")
export async function starPackage(userId: string, slug: string): Promise<void> {
  const { error } = await supabase
    .from('package_stars')
    .upsert({ user_id: userId, package_name: slug }, { onConflict: 'user_id,package_name' })
  if (error) throw error
}

// Unstar a package for a user.
export async function unstarPackage(userId: string, slug: string): Promise<void> {
  const { error } = await supabase
    .from('package_stars')
    .delete()
    .eq('user_id', userId)
    .eq('package_name', slug)
  if (error) throw error
}

// Returns true if the user has starred the package.
export async function hasStarred(userId: string, slug: string): Promise<boolean> {
  const { data } = await supabase
    .from('package_stars')
    .select('user_id')
    .eq('user_id', userId)
    .eq('package_name', slug)
    .single()
  return !!data
}

// Get star count for a package.
export async function getStarCount(slug: string): Promise<number> {
  // First try the denormalized column on packages (query by slug)
  const { data: pkg } = await supabase
    .from('packages')
    .select('star_count')
    .eq('slug', slug)
    .single()
  if (pkg !== null) return pkg.star_count ?? 0

  // Fallback: count from package_stars
  const { count, error } = await supabase
    .from('package_stars')
    .select('*', { count: 'exact', head: true })
    .eq('package_name', slug)
  if (error) throw error
  return count ?? 0
}

// Get star counts for multiple packages (batch). Returns map of slug -> count.
export async function getStarCounts(slugs: string[]): Promise<Record<string, number>> {
  if (slugs.length === 0) return {}

  // Use the denormalized star_count column on packages (query by slug)
  const { data, error } = await supabase
    .from('packages')
    .select('slug, star_count')
    .in('slug', slugs)
  if (error) throw error

  const counts: Record<string, number> = {}
  for (const slug of slugs) counts[slug] = 0
  for (const row of data ?? []) {
    if (counts.hasOwnProperty(row.slug)) counts[row.slug] = row.star_count ?? 0
  }
  return counts
}

// Get paginated starrers for a package.
export async function getPackageStarrers(
  slug: string,
  limitCount = 20,
  offsetCount = 0
): Promise<{ userId: string; starredAt: string }[]> {
  const { data, error } = await supabase
    .from('package_stars')
    .select('user_id, starred_at')
    .eq('package_name', slug)
    .order('starred_at', { ascending: false })
    .range(offsetCount, offsetCount + limitCount - 1)
  if (error) throw error
  return (data ?? []).map(r => ({ userId: r.user_id, starredAt: r.starred_at }))
}

// Get packages a user has starred.
export async function getUserStars(
  userId: string,
  limitCount = 20,
  offsetCount = 0
): Promise<{ packageName: string; starredAt: string }[]> {
  const { data, error } = await supabase
    .from('package_stars')
    .select('package_name, starred_at')
    .eq('user_id', userId)
    .order('starred_at', { ascending: false })
    .range(offsetCount, offsetCount + limitCount - 1)
  if (error) throw error
  return (data ?? []).map(r => ({ packageName: r.package_name, starredAt: r.starred_at }))
}

// Returns packages sorted by star count, with star counts.
export async function listPackagesByStars(
  limitCount = 20,
  offsetCount = 0
): Promise<{ packageName: string; starCount: number }[]> {
  // Use the denormalized star_count column on packages
  const { data, error } = await supabase
    .from('packages')
    .select('slug, star_count')
    .gt('star_count', 0)
    .order('star_count', { ascending: false })
    .range(offsetCount, offsetCount + limitCount - 1)
  if (error) throw error
  return (data ?? []).map(r => ({ packageName: r.slug, starCount: r.star_count ?? 0 }))
}

// === Ecosystem Health ===

export interface PackageHealth {
  package_name: string;
  computed_at: string;
  maintenance_score: number;
  maintenance_status: HealthStatus;
  popularity_score: number;
  popularity_status: HealthStatus;
  quality_score: number;
  quality_status: HealthStatus;
  compliance_score: number;
  compliance_status: HealthStatus;
  health_score: number;
  health_status: HealthStatus;
  last_release_at: string | null;
  release_frequency_days: number | null;
  open_issue_count: number;
  downloads_7d: number;
  downloads_30d: number;
  star_count: number;
  dependent_count: number;
  has_readme: boolean;
  has_tests: boolean;
  has_changelog: boolean;
  known_vuln_count: number;
  has_badge: boolean;
  license_compatible: boolean;
  ink_version_ok: boolean;
  deprecated_dep_count: number;
}

export type HealthStatus = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

export interface HealthLeadersResult {
  package_name: string;
  package_slug: string;
  health_score: number;
  health_status: HealthStatus;
  maintenance_status: HealthStatus;
  popularity_status: HealthStatus;
  quality_status: HealthStatus;
  compliance_status: HealthStatus;
}

export async function getPackageHealth(packageName: string): Promise<PackageHealth | null> {
  const { data, error } = await supabase.rpc('get_package_health', { p_package_name: packageName });
  if (error) throw error;
  return data as PackageHealth | null;
}

export async function getHealthLeaders(limit = 5): Promise<HealthLeadersResult[]> {
  const { data, error } = await supabase.rpc('get_health_leaders', { p_limit: limit });
  if (error) throw error;
  const results = (data ?? []) as Omit<HealthLeadersResult, 'package_slug'>[];

  if (results.length === 0) return [];

  // Fetch owner info to construct full slugs
  const packageNames = results.map(r => r.package_name);
  const { data: pkgRows } = await supabase
    .from('packages')
    .select('name, owner_slug')
    .in('name', packageNames);

  const ownerMap = new Map(pkgRows?.map(p => [p.name, p.owner_slug]) ?? []);

  return results.map(r => ({
    ...r,
    package_slug: `${ownerMap.get(r.package_name) ?? ''}/${r.package_name}`,
  }));
}

// Batch query to fetch health for multiple packages in one call
export async function getHealthForPackages(names: string[]): Promise<Record<string, PackageHealth | null>> {
  if (names.length === 0) return {};
  const { data, error } = await supabase.rpc('get_health_for_packages', { p_names: names });
  if (error) throw error;
  const results: Record<string, PackageHealth | null> = {};
  // Initialize all to null
  for (const name of names) results[name] = null;
  for (const row of (data ?? []) as PackageHealth[]) {
    results[row.package_name] = row;
  }
  return results;
}

export async function computePackageHealth(packageName: string): Promise<void> {
  const { error } = await supabase.rpc('compute_package_health', { p_package_name: packageName });
  if (error) throw error;
}

// ─── Package Reviews ─────────────────────────────────────────────────────────

export interface Review {
  id: string
  user_id: string
  package_name: string
  rating: number
  body: string | null
  created_at: string
  updated_at: string
  username?: string
  avatar_url?: string | null
}

export interface ReviewWithUser extends Review {
  username: string
  avatar_url: string | null
}

// Create a new review for a package
export async function createReview(
  userId: string,
  packageName: string,
  rating: number,
  body?: string
): Promise<Review> {
  const { data, error } = await supabase
    .from('package_reviews')
    .insert({
      user_id: userId,
      package_name: packageName,
      rating,
      body: body || null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Review
}

// Update an existing review
export async function updateReview(
  userId: string,
  packageName: string,
  rating: number,
  body?: string
): Promise<Review> {
  const { data, error } = await supabase
    .from('package_reviews')
    .update({
      rating,
      body: body || null,
    })
    .eq('user_id', userId)
    .eq('package_name', packageName)
    .select()
    .single()
  if (error) throw error
  return data as Review
}

// Delete a review
export async function deleteReview(userId: string, packageName: string): Promise<void> {
  const { error } = await supabase
    .from('package_reviews')
    .delete()
    .eq('user_id', userId)
    .eq('package_name', packageName)
  if (error) throw error
}

// Get reviews for a package (paginated)
export async function getPackageReviews(
  packageName: string,
  limit = 20,
  offset = 0
): Promise<Review[]> {
  const { data, error } = await supabase
    .from('package_reviews')
    .select('*')
    .eq('package_name', packageName)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw error
  return (data as Review[]) ?? []
}

// Get a specific user's review for a package
export async function getUserReview(
  userId: string,
  packageName: string
): Promise<Review | null> {
  const { data, error } = await supabase
    .from('package_reviews')
    .select('*')
    .eq('user_id', userId)
    .eq('package_name', packageName)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    throw error
  }
  return data as Review
}

// Get package rating summary
export async function getPackageRating(
  packageName: string
): Promise<{ avg: number; count: number }> {
  const { data, error } = await supabase
    .from('packages')
    .select('avg_rating, review_count')
    .eq('slug', packageName)
    .single()
  if (error) throw error
  return {
    avg: parseFloat(data.avg_rating) || 0,
    count: data.review_count || 0,
  }
}

// Get reviews for a package with user info (for display)
export async function getPackageReviewsWithUsers(
  packageName: string,
  limit = 20,
  offset = 0
): Promise<ReviewWithUser[]> {
  const reviews = await getPackageReviews(packageName, limit, offset)
  if (reviews.length === 0) return []

  // Fetch user info for all reviewers
  const userIds = [...new Set(reviews.map(r => r.user_id))]
  const { data: users } = await supabase
    .from('users')
    .select('id, user_name, avatar_url')
    .in('id', userIds)

  const userMap = new Map(
    (users ?? []).map(u => [u.id, { username: u.user_name ?? 'unknown', avatar_url: u.avatar_url }])
  )

  return reviews.map(r => ({
    ...r,
    username: userMap.get(r.user_id)?.username ?? 'unknown',
    avatar_url: userMap.get(r.user_id)?.avatar_url ?? null,
  }))
}

// ─── Feed ──────────────────────────────────────────────────────────────────────

export interface FeedEvent {
  id: string;
  type: 'new_package' | 'new_version' | 'starred_package';
  actor: { username: string; avatarUrl?: string };
  package: { slug: string; name: string; description?: string };
  version?: string;
  publishedAt: string;
}

export async function getFeedEvents(
  userId: string,
  limit = 20,
  offset = 0
): Promise<{ events: FeedEvent[]; total: number }> {
  // Get users and orgs the current user follows
  const [{ data: userFollows }, { data: orgFollows }] = await Promise.all([
    supabase.from('user_follows').select('following_id').eq('follower_id', userId),
    supabase.from('org_follows').select('org_id').eq('follower_id', userId),
  ])

  const followingUserIds = userFollows?.map(f => f.following_id) ?? []
  const followingOrgIds = orgFollows?.map(f => f.org_id) ?? []
  const allOwnerIds = [...followingUserIds, ...followingOrgIds]

  if (allOwnerIds.length === 0) {
    return { events: [], total: 0 }
  }

  // Fetch version events from followed owners
  const { data: versions, count } = await supabase
    .from('package_versions')
    .select('package_slug, version, published_at', { count: 'exact' })
    .in('owner_id', allOwnerIds)
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1)

  // Fetch package details and created_at for these packages
  const packageSlugs = [...new Set((versions ?? []).map(v => v.package_slug))]
  let packageMap = new Map<string, { name: string; display_name: string; owner_id: string; description: string | null }>()
  let createdAtMap = new Map<string, string>()

  if (packageSlugs.length > 0) {
    const { data: packages } = await supabase
      .from('packages')
      .select('slug, name, display_name, owner_id, description, created_at')
      .in('slug', packageSlugs)
    packageMap = new Map(packages?.map(p => [p.slug, { name: p.name, display_name: p.display_name, owner_id: p.owner_id, description: p.description }]) ?? [])
    createdAtMap = new Map(packages?.map(p => [p.slug, p.created_at]) ?? [])
  }

  // Fetch owner metadata for actor info
  const ownerIds = [...new Set([...packageMap.values()].map(p => p.owner_id))]
  const { data: ownerUsers } = await supabase
    .from('users')
    .select('id, user_name, avatar_url')
    .in('id', ownerIds.filter(id => followingUserIds.includes(id)))
  const { data: ownerOrgs } = await supabase
    .from('orgs')
    .select('id, name, avatar_url')
    .in('id', ownerIds.filter(id => followingOrgIds.includes(id)))

  const actorMap = new Map<string, { username: string; avatarUrl?: string }>()
  for (const u of ownerUsers ?? []) {
    actorMap.set(u.id, { username: u.user_name ?? 'unknown', avatarUrl: u.avatar_url ?? undefined })
  }
  for (const o of ownerOrgs ?? []) {
    actorMap.set(o.id, { username: o.name ?? 'unknown', avatarUrl: o.avatar_url ?? undefined })
  }

  // Build version events
  const events: FeedEvent[] = (versions ?? []).map(v => {
    const pkg = packageMap.get(v.package_slug)
    const actor = pkg ? actorMap.get(pkg.owner_id) : undefined
    const isNewPackage = createdAtMap.get(v.package_slug) === v.published_at
    return {
      id: `${v.package_slug}:${v.version}`,
      type: isNewPackage ? 'new_package' : 'new_version',
      actor: actor ?? { username: 'unknown' },
      package: {
        slug: v.package_slug,
        name: pkg?.display_name ?? pkg?.name ?? v.package_slug,
        description: pkg?.description ?? undefined,
      },
      version: v.version,
      publishedAt: v.published_at,
    } satisfies FeedEvent
  })

  // If following >= 5 users, also fetch starred packages
  let starEvents: FeedEvent[] = []
  if (followingUserIds.length >= 5) {
    const { data: stars } = await supabase
      .from('package_stars')
      .select('user_id, package_name, starred_at')
      .in('user_id', followingUserIds)
      .order('starred_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (stars && stars.length > 0) {
      const starredSlugs = [...new Set(stars.map(s => s.package_name))]
      const { data: starredPkgs } = await supabase
        .from('packages')
        .select('slug, name, display_name, description')
        .in('slug', starredSlugs)
      const starredPkgMap = new Map(starredPkgs?.map(p => [p.slug, p]) ?? [])
      const starActorMap = new Map((ownerUsers ?? []).map(u => [u.id, { username: u.user_name ?? 'unknown', avatarUrl: u.avatar_url ?? undefined }]))

      starEvents = stars.map(s => {
        const pkg = starredPkgMap.get(s.package_name)
        const actor = starActorMap.get(s.user_id)
        return {
          id: `star:${s.user_id}:${s.package_name}`,
          type: 'starred_package' as const,
          actor: actor ?? { username: 'unknown' },
          package: {
            slug: s.package_name,
            name: pkg?.display_name ?? pkg?.name ?? s.package_name,
            description: pkg?.description ?? undefined,
          },
          publishedAt: s.starred_at,
        } satisfies FeedEvent
      })
    }
  }

  // Merge and re-sort all events by publishedAt desc
  const allEvents = [...events, ...starEvents]
  allEvents.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())

  const total = (count ?? 0) + starEvents.length
  return { events: allEvents.slice(0, limit), total }
}

// ─── Package Transfer ──────────────────────────────────────────────────────────

export interface TransferRequest {
  id: string
  package_name: string
  from_owner_id: string
  from_owner_type: 'user' | 'org'
  to_owner_id: string
  to_owner_type: 'user' | 'org'
  new_slug: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'
  created_at: string
  expires_at: string
  accepted_at: string | null
  declined_at: string | null
  cancelled_at: string | null
}

export interface TransferRequestWithOwners extends TransferRequest {
  from_owner_username?: string
  from_owner_avatar?: string | null
  to_owner_username?: string
  to_owner_avatar?: string | null
  old_slug?: string
}

// Create a new transfer request
export async function createTransferRequest(
  packageName: string,
  fromOwnerId: string,
  fromOwnerType: 'user' | 'org',
  toOwnerId: string,
  toOwnerType: 'user' | 'org',
  newSlug: string
): Promise<TransferRequest> {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  const { data, error } = await supabase
    .from('package_transfer_requests')
    .insert({
      package_name: packageName,
      from_owner_id: fromOwnerId,
      from_owner_type: fromOwnerType,
      to_owner_id: toOwnerId,
      to_owner_type: toOwnerType,
      new_slug: newSlug,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single()

  if (error) throw error
  return data as TransferRequest
}

// Get a transfer request by ID
export async function getTransferRequest(id: string): Promise<TransferRequestWithOwners | null> {
  const { data, error } = await supabase
    .from('package_transfer_requests')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  const transfer = data as TransferRequestWithOwners

  // Fetch owner usernames
  if (transfer.from_owner_type === 'user') {
    const { data: user } = await supabase
      .from('users')
      .select('user_name, avatar_url')
      .eq('id', transfer.from_owner_id)
      .single()
    if (user) {
      transfer.from_owner_username = user.user_name ?? undefined
      transfer.from_owner_avatar = user.avatar_url ?? null
    }
  } else {
    const { data: org } = await supabase
      .from('orgs')
      .select('name, avatar_url')
      .eq('id', transfer.from_owner_id)
      .single()
    if (org) {
      transfer.from_owner_username = org.name ?? undefined
      transfer.from_owner_avatar = org.avatar_url ?? null
    }
  }

  if (transfer.to_owner_type === 'user') {
    const { data: user } = await supabase
      .from('users')
      .select('user_name, avatar_url')
      .eq('id', transfer.to_owner_id)
      .single()
    if (user) {
      transfer.to_owner_username = user.user_name ?? undefined
      transfer.to_owner_avatar = user.avatar_url ?? null
    }
  } else {
    const { data: org } = await supabase
      .from('orgs')
      .select('name, avatar_url')
      .eq('id', transfer.to_owner_id)
      .single()
    if (org) {
      transfer.to_owner_username = org.name ?? undefined
      transfer.to_owner_avatar = org.avatar_url ?? null
    }
  }

  // Get old slug from packages table
  const { data: pkg } = await supabase
    .from('packages')
    .select('slug')
    .eq('name', transfer.package_name)
    .eq('owner_id', transfer.from_owner_id)
    .single()
  if (pkg) {
    transfer.old_slug = pkg.slug
  }

  return transfer
}

// Get pending transfer for a package
export async function getPendingTransfer(packageName: string): Promise<TransferRequest | null> {
  const { data, error } = await supabase
    .from('package_transfer_requests')
    .select('*')
    .eq('package_name', packageName)
    .eq('status', 'pending')
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data as TransferRequest
}

// Get transfers for a user (where they are initiator or recipient)
export async function getTransfersForUser(userId: string): Promise<TransferRequest[]> {
  const { data, error } = await supabase
    .from('package_transfer_requests')
    .select('*')
    .or(`from_owner_id.eq.${userId},to_owner_id.eq.${userId}`)
    .in('status', ['pending', 'accepted', 'declined', 'cancelled'])
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as TransferRequest[]) ?? []
}

// Accept a transfer (atomic slug rename)
export async function acceptTransfer(id: string): Promise<{ oldSlug: string; newSlug: string }> {
  const transfer = await getTransferRequest(id)
  if (!transfer) throw new Error('Transfer not found')
  if (transfer.status !== 'pending') throw new Error('Transfer is not pending')
  if (new Date(transfer.expires_at) < new Date()) throw new Error('Transfer has expired')

  const oldSlug = transfer.old_slug ?? `${transfer.package_name}` // fallback
  const newSlug = transfer.new_slug

  // Get the current owner slug for the new owner
  let newOwnerSlug: string
  if (transfer.to_owner_type === 'user') {
    const { data: user } = await supabase
      .from('users')
      .select('user_name')
      .eq('id', transfer.to_owner_id)
      .single()
    newOwnerSlug = user?.user_name ?? transfer.to_owner_id
  } else {
    const { data: org } = await supabase
      .from('orgs')
      .select('slug')
      .eq('id', transfer.to_owner_id)
      .single()
    newOwnerSlug = org?.slug ?? transfer.to_owner_id
  }

  // Atomic transaction: rename slug across all tables
  // Use rpc function for the atomic transaction
  const { error: rpcError } = await supabase.rpc('accept_package_transfer', {
    p_id: id,
    p_old_slug: oldSlug,
    p_new_slug: newSlug,
    p_new_owner_id: transfer.to_owner_id,
    p_new_owner_type: transfer.to_owner_type,
    p_new_owner_slug: newOwnerSlug,
    p_package_name: transfer.package_name,
  })

  if (rpcError) {
    // Fallback: manual transaction if RPC doesn't exist
    // Update packages
    const { error: pkgErr } = await supabase
      .from('packages')
      .update({
        slug: newSlug,
        owner_slug: newOwnerSlug,
        owner_id: transfer.to_owner_id,
        owner_type: transfer.to_owner_type,
      })
      .eq('name', transfer.package_name)
      .eq('slug', oldSlug)

    if (pkgErr) throw pkgErr

    // Update package_versions
    await supabase
      .from('package_versions')
      .update({ package_slug: newSlug })
      .eq('package_slug', oldSlug)

    // Update package_stars (stores full slug)
    await supabase
      .from('package_stars')
      .update({ package_name: newSlug })
      .eq('package_name', oldSlug)

    // Update package_reviews (stores full slug)
    await supabase
      .from('package_reviews')
      .update({ package_name: newSlug })
      .eq('package_name', oldSlug)

    // Update download_logs (stores full slug)
    await supabase
      .from('download_logs')
      .update({ package_name: newSlug })
      .eq('package_name', oldSlug)

    // Update package_tags (stores short name)
    const oldShortName = oldSlug.includes('/') ? oldSlug.split('/').pop()! : oldSlug
    const newShortName = newSlug.includes('/') ? newSlug.split('/').pop()! : newSlug
    await supabase
      .from('package_tags')
      .update({ package_name: newShortName })
      .eq('package_name', oldShortName)

    // Insert redirect
    await supabase
      .from('package_redirects')
      .upsert({ old_slug: oldSlug, new_slug: newSlug }, { onConflict: 'old_slug' })

    // Insert transfer history
    await supabase
      .from('package_transfer_history')
      .insert({
        package_name: transfer.package_name,
        from_owner_id: transfer.from_owner_id,
        to_owner_id: transfer.to_owner_id,
        new_slug: newSlug,
      })

    // Cancel other pending transfers for this package
    await supabase
      .from('package_transfer_requests')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('package_name', transfer.package_name)
      .eq('status', 'pending')
      .neq('id', id)
  }

  // Update transfer request status
  await supabase
    .from('package_transfer_requests')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', id)

  return { oldSlug, newSlug }
}

// Decline a transfer
export async function declineTransfer(id: string): Promise<void> {
  const transfer = await getTransferRequest(id)
  if (!transfer) throw new Error('Transfer not found')
  if (transfer.status !== 'pending') throw new Error('Transfer is not pending')

  const { error } = await supabase
    .from('package_transfer_requests')
    .update({ status: 'declined', declined_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw error
}

// Cancel a transfer (by initiator)
export async function cancelTransfer(id: string): Promise<void> {
  const transfer = await getTransferRequest(id)
  if (!transfer) throw new Error('Transfer not found')
  if (transfer.status !== 'pending') throw new Error('Transfer is not pending')

  const { error } = await supabase
    .from('package_transfer_requests')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw error
}

// Check if a package has been migrated (returns redirect target if exists)
export async function getPackageRedirect(oldSlug: string): Promise<string | null> {
  const { data } = await supabase
    .from('package_redirects')
    .select('new_slug')
    .eq('old_slug', oldSlug)
    .single()

  return data?.new_slug ?? null
}

// Get transfer history for a package
export async function getPackageTransferHistory(packageName: string): Promise<Array<{
  id: string
  package_name: string
  from_owner_id: string
  to_owner_id: string
  new_slug: string
  transferred_at: string
}>> {
  const { data, error } = await supabase
    .from('package_transfer_history')
    .select('*')
    .eq('package_name', packageName)
    .order('transferred_at', { ascending: false })

  if (error) throw error
  return data ?? []
}
