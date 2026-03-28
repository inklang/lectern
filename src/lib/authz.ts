import { supabase } from './supabase.js'
import { getPackagePermissionForUser } from './orgs.js'

/**
 * Checks if a user can publish to a package.
 * - User-owned (owner_type = 'user'): allow iff userId === packages.owner_id
 * - Org-owned (owner_type = 'org'): user must be org member AND have write/admin permission on this package
 * - Package doesn't exist yet: return true (caller handles first-publish ownership)
 */
export async function canUserPublish(userId: string, slug: string): Promise<boolean> {
  const { data: pkg } = await supabase
    .from('packages')
    .select('owner_id, owner_type')
    .eq('slug', slug)
    .single()

  if (!pkg) {
    // Package doesn't exist yet — first publisher will own it
    return true
  }

  if (pkg.owner_type === 'user') {
    return pkg.owner_id === userId
  }

  if (pkg.owner_type === 'org') {
    // Check org membership
    const { data: member } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', pkg.owner_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (!member) return false

    // Check per-package permission via teams
    try {
      // Extract short name from slug for permission lookup
      const shortName = slug.includes('/') ? slug.split('/').pop()! : slug
      const perm = await getPackagePermissionForUser(pkg.owner_id, userId, shortName)
      return perm === 'write' || perm === 'admin'
    } catch {
      return false // DB error — deny rather than leak error
    }
  }

  return false
}

/**
 * Checks if a user can read a package's details/versions.
 * - User-owned (owner_type = 'user'): allow only the owner
 * - Org-owned (owner_type = 'org'): user must be org member AND have at least read permission
 * - Package doesn't exist: return false
 */
export async function canUserRead(userId: string, slug: string): Promise<boolean> {
  const { data: pkg } = await supabase
    .from('packages')
    .select('owner_id, owner_type')
    .eq('slug', slug)
    .single()

  if (!pkg) {
    return false
  }

  if (pkg.owner_type === 'user') {
    return pkg.owner_id === userId
  }

  if (pkg.owner_type === 'org') {
    // Check org membership
    const { data: member } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', pkg.owner_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (!member) return false

    // Check per-package permission via teams
    try {
      // Extract short name from slug for permission lookup
      const shortName = slug.includes('/') ? slug.split('/').pop()! : slug
      const perm = await getPackagePermissionForUser(pkg.owner_id, userId, shortName)
      return perm === 'read' || perm === 'write' || perm === 'admin'
    } catch {
      return false // DB error — deny rather than leak error
    }
  }

  return false
}

/**
 * Returns the org slug for an org-owned package, or null for user-owned.
 */
export async function getPackageOrgSlug(slug: string): Promise<string | null> {
  const { data: pkg } = await supabase
    .from('packages')
    .select('owner_id, owner_type')
    .eq('slug', slug)
    .single()

  if (!pkg || pkg.owner_type !== 'org') return null

  const { data: org } = await supabase
    .from('orgs')
    .select('slug')
    .eq('id', pkg.owner_id)
    .single()

  return org?.slug ?? null
}

/**
 * Checks if a user can deprecate/un-deprecate a package.
 * - User-owned: allow iff userId === packages.owner_id
 * - Org-owned: user must be org admin (owner or admin role)
 * - Package doesn't exist: return false
 */
export async function canUserDeprecate(userId: string, slug: string): Promise<boolean> {
  const { data: pkg } = await supabase
    .from('packages')
    .select('owner_id, owner_type')
    .eq('slug', slug)
    .single()

  if (!pkg) {
    return false
  }

  if (pkg.owner_type === 'user') {
    return pkg.owner_id === userId
  }

  if (pkg.owner_type === 'org') {
    // For org-owned packages, only org admins can deprecate
    const { data: member } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', pkg.owner_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (!member) return false
    return member.role === 'owner' || member.role === 'admin'
  }

  return false
}

/**
 * Checks if a user can manage (transfer) a package.
 * - User-owned (owner_type = 'user'): allow iff userId === packages.owner_id
 * - Org-owned (owner_type = 'org'): user must be org admin (owner or admin role)
 * - Package doesn't exist: return false
 */
export async function canManage(userId: string, slug: string): Promise<boolean> {
  const { data: pkg } = await supabase
    .from('packages')
    .select('owner_id, owner_type')
    .eq('slug', slug)
    .single()

  if (!pkg) {
    return false
  }

  if (pkg.owner_type === 'user') {
    return pkg.owner_id === userId
  }

  if (pkg.owner_type === 'org') {
    // For org-owned packages, only org admins can manage (transfer)
    const { data: member } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', pkg.owner_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (!member) return false
    return member.role === 'owner' || member.role === 'admin'
  }

  return false
}
