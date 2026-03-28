import { supabase } from './supabase.js'

export interface UserProfile {
  id: string
  user_name: string
  email?: string
  bio?: string
  website?: string
  twitter?: string
  github?: string
  avatar_url?: string
  created_at: string
}

export async function getUserProfile(username: string): Promise<UserProfile | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('user_name', username)
    .single()
  return data ?? null
}

export async function updateUserProfile(
  userId: string,
  updates: {
    bio?: string
    website?: string
    twitter?: string
    github?: string
    avatar_url?: string
  }
): Promise<UserProfile> {
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getUserStarredPackages(
  userId: string,
  limit = 20,
  offset = 0
): Promise<{ packageName: string; starredAt: string }[]> {
  const { data, error } = await supabase
    .from('package_stars')
    .select('package_name, starred_at')
    .eq('user_id', userId)
    .order('starred_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw error
  return (data ?? []).map(r => ({
    packageName: r.package_name,
    starredAt: r.starred_at,
  }))
}

export async function getUserPinnedPackages(
  userId: string
): Promise<{ packageName: string; pinnedAt: string; position: number }[]> {
  const { data, error } = await supabase
    .from('user_pinned_packages')
    .select('package_name, pinned_at, position')
    .eq('user_id', userId)
    .order('position', { ascending: true })
  if (error) throw error
  return (data ?? []).map(r => ({
    packageName: r.package_name,
    pinnedAt: r.pinned_at,
    position: r.position,
  }))
}

export async function pinPackage(
  userId: string,
  packageName: string,
  position: number
): Promise<void> {
  const { error } = await supabase
    .from('user_pinned_packages')
    .upsert(
      { user_id: userId, package_name: packageName, position },
      { onConflict: 'user_id,package_name' }
    )
  if (error) throw error
}

export async function unpinPackage(userId: string, packageName: string): Promise<void> {
  const { error } = await supabase
    .from('user_pinned_packages')
    .delete()
    .eq('user_id', userId)
    .eq('package_name', packageName)
  if (error) throw error
}

export async function getUserFollowerCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('user_follows')
    .select('*', { count: 'exact', head: true })
    .eq('following_id', userId)
  if (error) throw error
  return count ?? 0
}

export async function getUserFollowingCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('user_follows')
    .select('*', { count: 'exact', head: true })
    .eq('follower_id', userId)
  if (error) throw error
  return count ?? 0
}

export async function getOrgFollowerCount(orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from('org_follows')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
  if (error) throw error
  return count ?? 0
}
