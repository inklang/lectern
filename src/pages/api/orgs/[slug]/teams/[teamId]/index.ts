import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getOrgBySlug, deleteOrgTeam, updateOrgTeam, isOrgAdmin, getOrgTeams } from '../../../../../../lib/orgs.js'
import { logAuditEvent } from '../../../../../../lib/audit.js'

export const PUT: APIRoute = async ({ params, request }) => {
  const { slug, teamId } = params
  if (!slug || !teamId) return new Response('Not found', { status: 404 })

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
  const userId = user.id

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  // Only admins can update teams
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const teams = await getOrgTeams(org.id)
  const team = teams.find(t => t.id === teamId)
  if (!team) return new Response('Not found', { status: 404 })

  const body = await request.json()
  const { name } = body
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const updated = await updateOrgTeam(org.id, teamId, name.trim())
    return new Response(JSON.stringify(updated), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    if (e.code === '23505') return new Response(JSON.stringify({ error: 'team name already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ error: 'failed to update team' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export const DELETE: APIRoute = async ({ params, request }) => {
  const { slug, teamId } = params
  if (!slug || !teamId) return new Response('Not found', { status: 404 })

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
  const userId = user.id

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  // Only admins can delete teams
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const teams = await getOrgTeams(org.id)
  const team = teams.find(t => t.id === teamId)
  if (!team) return new Response('Not found', { status: 404 })

  try {
    await deleteOrgTeam(org.id, teamId)

    // Log audit event
    logAuditEvent({
      orgId: org.id,
      userId,
      action: 'team.delete',
      resourceType: 'team',
      resourceId: teamId,
      details: { teamName: team.name },
      ipAddress: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    }).catch(() => {})

    return new Response(null, { status: 204 })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'failed to delete team' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
