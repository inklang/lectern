import { supabase } from './supabase.js'

export interface PackageVersion {
  package_name: string
  version: string
  description: string | null
  readme: string | null
  dependencies: Record<string, string>
  tarball_url: string
  published_at: string
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
export async function createPackage(name: string, ownerId: string): Promise<void> {
  const { error } = await supabase
    .from('packages')
    .insert({ name, owner_id: ownerId })
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
