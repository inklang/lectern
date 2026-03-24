import { supabase } from './supabase.js'

export interface Org {
  id: string
  slug: string
  name: string
  description: string | null
  creator_id: string
  created_at: string
}

export interface OrgMember {
  org_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  joined_at: string
}

export interface OrgTeam {
  id: string
  org_id: string
  name: string
  created_at: string
}

export interface OrgTeamMember {
  team_id: string
  user_id: string
  joined_at: string
}

export async function getOrgBySlug(slug: string): Promise<Org | null> {
  const { data } = await supabase
    .from('orgs')
    .select('*')
    .eq('slug', slug)
    .single()
  return data ?? null
}

export async function getOrgById(id: string): Promise<Org | null> {
  const { data } = await supabase
    .from('orgs')
    .select('*')
    .eq('id', id)
    .single()
  return data ?? null
}

export async function getUserOrgs(userId: string): Promise<(Org & { role: string })[]> {
  const { data, error } = await supabase
    .from('org_members')
    .select('*, orgs(*)')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? []).map(row => ({
    ...row.orgs,
    role: row.role,
  }))
}

export async function createOrg(slug: string, name: string, creatorId: string, description?: string): Promise<Org> {
  const { data, error } = await supabase
    .from('orgs')
    .insert({ slug, name, creator_id: creatorId, description: description ?? null })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getOrgMembers(orgId: string): Promise<OrgMember[]> {
  const { data, error } = await supabase
    .from('org_members')
    .select('*')
    .eq('org_id', orgId)
  if (error) throw error
  return data ?? []
}

export async function addOrgMember(orgId: string, userId: string, role: 'owner' | 'admin' | 'member' = 'member'): Promise<void> {
  const { error } = await supabase
    .from('org_members')
    .insert({ org_id: orgId, user_id: userId, role })
  if (error) throw error
}

export async function removeOrgMember(orgId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('org_members')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function updateOrgMemberRole(orgId: string, userId: string, role: 'owner' | 'admin' | 'member'): Promise<void> {
  const { error } = await supabase
    .from('org_members')
    .update({ role })
    .eq('org_id', orgId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function getOrgTeams(orgId: string): Promise<OrgTeam[]> {
  const { data, error } = await supabase
    .from('org_teams')
    .select('*')
    .eq('org_id', orgId)
  if (error) throw error
  return data ?? []
}

export async function createOrgTeam(orgId: string, name: string): Promise<OrgTeam> {
  const { data, error } = await supabase
    .from('org_teams')
    .insert({ org_id: orgId, name })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getTeamMembers(teamId: string): Promise<OrgTeamMember[]> {
  const { data, error } = await supabase
    .from('org_team_members')
    .select('*')
    .eq('team_id', teamId)
  if (error) throw error
  return data ?? []
}

export async function addTeamMember(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('org_team_members')
    .insert({ team_id: teamId, user_id: userId })
  if (error) throw error
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('org_team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function getTeamsForPackage(orgId: string, packageName: string): Promise<Array<OrgTeam & { permission: string | null }>> {
  const { data, error } = await supabase
    .from('org_teams')
    .select('*, org_package_permissions(permission)')
    .eq('org_id', orgId)
  if (error) throw error
  return (data ?? []).map(row => ({
    ...row,
    permission: row.org_package_permissions?.permission ?? null,
  }))
}

export async function setPackagePermission(teamId: string, packageName: string, permission: 'read' | 'write' | 'admin' | null): Promise<void> {
  if (permission === null) {
    const { error } = await supabase
      .from('org_package_permissions')
      .delete()
      .eq('team_id', teamId)
      .eq('package_name', packageName)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('org_package_permissions')
      .upsert({ team_id: teamId, package_name: packageName, permission })
    if (error) throw error
  }
}

export async function getPackagePermissionForUser(orgId: string, userId: string, packageName: string): Promise<'read' | 'write' | 'admin' | null> {
  // Get all teams in this org that the user is a member of
  const { data: teamMemberships, error } = await supabase
    .from('org_team_members')
    .select('team_id')
    .eq('user_id', userId)
  if (error) throw error

  const teamIds = (teamMemberships ?? []).map(m => m.team_id)
  if (teamIds.length === 0) return null

  // Get the teams that belong to this org
  const { data: teams, error: teamsError } = await supabase
    .from('org_teams')
    .select('id')
    .eq('org_id', orgId)
    .in('id', teamIds)
  if (teamsError) throw teamsError

  const orgTeamIds = (teams ?? []).map(t => t.id)
  if (orgTeamIds.length === 0) return null

  // Check package permissions for these teams
  const { data: permissions, error: permError } = await supabase
    .from('org_package_permissions')
    .select('permission')
    .in('team_id', orgTeamIds)
    .eq('package_name', packageName)
  if (permError) throw permError

  // Return the highest permission
  if (permissions === null || permissions.length === 0) return null
  const perms = permissions.map(p => p.permission)
  if (perms.includes('admin')) return 'admin'
  if (perms.includes('write')) return 'write'
  if (perms.includes('read')) return 'read'
  return null
}

export async function isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single()
  if (!data) return false
  return data.role === 'owner' || data.role === 'admin'
}

export async function isOrgOwner(orgId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single()
  if (!data) return false
  return data.role === 'owner'
}

export async function slugAvailable(slug: string): Promise<boolean> {
  const { data } = await supabase
    .from('orgs')
    .select('id')
    .eq('slug', slug)
    .single()
  return !data
}

export async function createInvite(orgId: string, createdBy: string, expiresInHours?: number, maxUses?: number): Promise<{ token: string; url: string }> {
  const { randomBytes } = await import('crypto')
  const token = randomBytes(8).toString('hex')
  const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000'
  const expiresAt = expiresInHours
    ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
    : null

  const { error } = await supabase
    .from('org_invites')
    .insert({
      org_id: orgId,
      created_by: createdBy,
      token,
      expires_at: expiresAt,
      max_uses: maxUses ?? null,
      use_count: 0,
    })
  if (error) throw error

  return { token, url: `${baseUrl}/invite/${token}` }
}

export async function useInvite(token: string, joiningUserId: string): Promise<{ orgId: string } | null> {
  // Fetch the invite
  const { data: invite, error } = await supabase
    .from('org_invites')
    .select('*')
    .eq('token', token)
    .single()
  if (error || !invite) return null

  // Check expiration
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) return null

  // Check use limit
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) return null

  // Add user to org_members as member FIRST (before consuming invite)
  // This avoids wasting the invite if the member insert fails
  const { error: memberError } = await supabase
    .from('org_members')
    .insert({ org_id: invite.org_id, user_id: joiningUserId, role: 'member' })
  if (memberError) {
    // If user is already a member (unique constraint violation), return null
    if (memberError.code === '23505') return null
    throw memberError
  }

  // Increment use count (fire and forget - acceptable if this fails since member was added)
  await supabase
    .from('org_invites')
    .update({ use_count: invite.use_count + 1 })
    .eq('token', token)

  return { orgId: invite.org_id }
}
