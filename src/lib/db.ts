import { supabase } from './supabase.js'

export interface PackageVersion {
  package_name: string
  version: string
  description: string | null
  readme: string | null
  author: string | null
  license: string | null
  dependencies: Record<string, string>
  tarball_url: string
  published_at: string
  download_count?: number
}

export interface PackageRow {
  name: string
  owner_id: string
  created_at: string
}

// Returns all packages with all their versions (for /index.json)
export async function listAllPackages(): Promise<Record<string, Record<string, PackageVersion>>> {
  const { data, error } = await supabase
    .from('package_versions')
    .select('*')
    .order('published_at', { ascending: false })
  if (error) throw error

  const result: Record<string, Record<string, PackageVersion>> = {}
  for (const row of data ?? []) {
    if (!result[row.package_name]) result[row.package_name] = {}
    result[row.package_name][row.version] = row
  }
  return result
}

// Returns all versions for a single package, sorted newest first
export async function getPackageVersions(name: string): Promise<PackageVersion[]> {
  const { data, error } = await supabase
    .from('package_versions')
    .select('*')
    .eq('package_name', name)
    .order('published_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Returns the owner fingerprint (user_id) for a package, or null
export async function getPackageOwner(name: string): Promise<string | null> {
  const { data } = await supabase
    .from('packages')
    .select('owner_id')
    .eq('name', name)
    .single()
  return data?.owner_id ?? null
}

// Registers a new package (first publish)
export async function createPackage(name: string, ownerId: string, ownerType: 'user' | 'org' = 'user'): Promise<void> {
  const { error } = await supabase
    .from('packages')
    .insert({ name, owner_id: ownerId, owner_type: ownerType })
  if (error) throw error
}

// Inserts a new package version row
export async function insertVersion(version: Omit<PackageVersion, 'published_at'> & { embedding?: number[] | null }): Promise<void> {
  const { error } = await supabase
    .from('package_versions')
    .insert(version)
  if (error) throw error
}

// Returns true if name@version already exists
export async function versionExists(name: string, version: string): Promise<boolean> {
  const { data } = await supabase
    .from('package_versions')
    .select('version')
    .eq('package_name', name)
    .eq('version', version)
    .single()
  return !!data
}

export interface PackageDependentsResult {
  package_name: string
  version: string
  dep_version: string | null
}

// Returns packages/versions that depend on the given package name
// The JSONB column stores deps as {"pkgName": "versionRange", ...}
// We filter client-side since the @> operator checks full value containment
export async function getPackageDependents(pkgName: string): Promise<PackageDependentsResult[]> {
  const { data, error } = await supabase
    .from('package_versions')
    .select('package_name, version, dependencies')
  if (error) throw error

  // Filter to only those whose dependencies include pkgName
  return (data ?? [])
    .filter(row => (row.dependencies as Record<string, string>)?.hasOwnProperty(pkgName))
    .map(row => {
      const depVersion = (row.dependencies as Record<string, string>)?.[pkgName] ?? null
      return {
        package_name: row.package_name,
        version: row.version,
        dep_version: depVersion,
      }
    })
}

// Returns the dependency tree for a specific version
export async function getVersionDependencies(name: string, version: string): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('package_versions')
    .select('dependencies')
    .eq('package_name', name)
    .eq('version', version)
    .single()
  if (error) throw error
  return (data?.dependencies as Record<string, string>) ?? {}
}

// Logs a download event and increments the version's download_count.
// authHeader is optional; if provided and resolves to a user, logs the user_id.
export async function logDownload(
  name: string,
  version: string,
  authHeader: string | null
): Promise<void> {
  const { extractBearer, resolveToken } = await import('./tokens.js')
  let userId: string | null = null
  if (authHeader) {
    const token = extractBearer(authHeader)
    if (token) userId = await resolveToken(token)
  }

  // Insert log entry
  await supabase.from('download_logs').insert({
    package_name: name,
    version,
    user_id: userId ?? undefined,
  })

  // Atomically increment the counter on package_versions
  await supabase.rpc('increment_download_count', { pkg_name: name, ver: version })
}

// Returns download stats for a package: total (from version rows), last7d, last30d (from logs)
export async function getPackageStats(name: string): Promise<{ total: number; last7d: number; last30d: number }> {
  const { data, error } = await supabase.rpc('get_package_stats', { pkg_name: name })
  if (error) throw error
  return data as { total: number; last7d: number; last30d: number }
}

export interface TrendingPackage {
  package_name: string
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
  return (data as TrendingPackage[]) ?? []
}

// ─── Popularity Score ───────────────────────────────────────────────────────────

export interface PopularPackage {
  package_name: string
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
  return (data as PopularPackage[]) ?? []
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
export async function addPackageTag(pkgName: string, tag: string): Promise<void> {
  // Upsert the tag (idempotent)
  await supabase.from('tags').upsert({ name: tag }).catch(() => {})
  const { error } = await supabase.from('package_tags').insert({ package_name: pkgName, tag })
  if (error) throw error
}

// Remove a tag from a package.
export async function removePackageTag(pkgName: string, tag: string): Promise<void> {
  const { error } = await supabase
    .from('package_tags')
    .delete()
    .eq('package_name', pkgName)
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
export async function starPackage(userId: string, packageName: string): Promise<void> {
  const { error } = await supabase
    .from('package_stars')
    .upsert({ user_id: userId, package_name: packageName }, { onConflict: 'user_id,package_name' })
  if (error) throw error
}

// Unstar a package for a user.
export async function unstarPackage(userId: string, packageName: string): Promise<void> {
  const { error } = await supabase
    .from('package_stars')
    .delete()
    .eq('user_id', userId)
    .eq('package_name', packageName)
  if (error) throw error
}

// Returns true if the user has starred the package.
export async function hasStarred(userId: string, packageName: string): Promise<boolean> {
  const { data } = await supabase
    .from('package_stars')
    .select('user_id')
    .eq('user_id', userId)
    .eq('package_name', packageName)
    .single()
  return !!data
}

// Get star count for a package.
export async function getStarCount(packageName: string): Promise<number> {
  // First try the denormalized column on packages
  const { data: pkg } = await supabase
    .from('packages')
    .select('star_count')
    .eq('name', packageName)
    .single()
  if (pkg !== null) return pkg.star_count ?? 0

  // Fallback: count from package_stars
  const { count, error } = await supabase
    .from('package_stars')
    .select('*', { count: 'exact', head: true })
    .eq('package_name', packageName)
  if (error) throw error
  return count ?? 0
}

// Get star counts for multiple packages (batch). Returns map of package_name -> count.
export async function getStarCounts(packageNames: string[]): Promise<Record<string, number>> {
  if (packageNames.length === 0) return {}

  // Use the denormalized star_count column on packages
  const { data, error } = await supabase
    .from('packages')
    .select('name, star_count')
  if (error) throw error

  const counts: Record<string, number> = {}
  for (const name of packageNames) counts[name] = 0
  for (const row of data ?? []) {
    if (counts.hasOwnProperty(row.name)) counts[row.name] = row.star_count ?? 0
  }
  return counts
}

// Get paginated starrers for a package.
export async function getPackageStarrers(
  packageName: string,
  limitCount = 20,
  offsetCount = 0
): Promise<{ userId: string; starredAt: string }[]> {
  const { data, error } = await supabase
    .from('package_stars')
    .select('user_id, starred_at')
    .eq('package_name', packageName)
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
    .select('name, star_count')
    .gt('star_count', 0)
    .order('star_count', { ascending: false })
    .range(offsetCount, offsetCount + limitCount - 1)
  if (error) throw error
  return (data ?? []).map(r => ({ packageName: r.name, starCount: r.star_count ?? 0 }))
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
  return (data ?? []) as HealthLeadersResult[];
}

export async function computePackageHealth(packageName: string): Promise<void> {
  const { error } = await supabase.rpc('compute_package_health', { p_package_name: packageName });
  if (error) throw error;
}
