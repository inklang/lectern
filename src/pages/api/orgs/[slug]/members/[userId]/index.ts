import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getOrgBySlug, updateOrgMemberRole, removeOrgMember, isOrgAdmin, isOrgOwner, getOrgMembers } from '../../../../../../lib/orgs.js'
import { logAuditEvent } from '../../../../../../lib/audit.js'

export const PUT: APIRoute = async ({ params, request }) => {
  const { slug, userId } = params
  if (!slug || !userId) return new Response('Not found', { status: 404 })

  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY ?? ''

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() { return parseCookieHeader(request.headers.get('Cookie') ?? '') },
      setAll() {},
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const currentUserId = user.id

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  // Only admins can update roles
  if (!(await isOrgAdmin(org.id, currentUserId))) return new Response('Forbidden', { status: 403 })

  const body = await request.json()
  const { role } = body
  if (!role || !['owner', 'admin', 'member'].includes(role)) {
    return new Response(JSON.stringify({ error: 'role must be one of: owner, admin, member' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Check if trying to change owner role - only current owner can do that
  const members = await getOrgMembers(org.id)
  const targetMember = members.find(m => m.user_id === userId)
  if (!targetMember) return new Response(JSON.stringify({ error: 'member not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })

  if (targetMember.role === 'owner' && role !== 'owner') {
    // Cannot demote the owner
    return new Response(JSON.stringify({ error: 'cannot demote the owner' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }

  if (role === 'owner' && !(await isOrgOwner(org.id, currentUserId))) {
    // Only owner can transfer ownership
    return new Response(JSON.stringify({ error: 'only owner can transfer ownership' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    await updateOrgMemberRole(org.id, userId, role)

    // Log audit event
    logAuditEvent({
      orgId: org.id,
      userId: currentUserId,
      action: 'member.role_change',
      resourceType: 'member',
      resourceId: userId,
      details: { newRole: role, previousRole: targetMember.role },
      ipAddress: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    }).catch(() => {})

    return new Response(null, { status: 204 })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'failed to update member role' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export const DELETE: APIRoute = async ({ params, request }) => {
  const { slug, userId } = params
  if (!slug || !userId) return new Response('Not found', { status: 404 })

  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY ?? ''

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() { return parseCookieHeader(request.headers.get('Cookie') ?? '') },
      setAll() {},
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const currentUserId = user.id

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  // Cannot remove the owner
  const members = await getOrgMembers(org.id)
  const targetMember = members.find(m => m.user_id === userId)
  if (!targetMember) return new Response(JSON.stringify({ error: 'member not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })

  if (targetMember.role === 'owner') {
    return new Response(JSON.stringify({ error: 'cannot remove the owner' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }

  // Admins can remove members, members can remove themselves
  if (userId !== currentUserId && !(await isOrgAdmin(org.id, currentUserId))) {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    await removeOrgMember(org.id, userId)

    // Log audit event
    logAuditEvent({
      orgId: org.id,
      userId: currentUserId,
      action: 'member.remove',
      resourceType: 'member',
      resourceId: userId,
      ipAddress: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    }).catch(() => {})

    return new Response(null, { status: 204 })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'failed to remove member' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
