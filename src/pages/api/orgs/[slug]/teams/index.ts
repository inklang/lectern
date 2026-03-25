import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getOrgBySlug, getOrgTeams, createOrgTeam, isOrgAdmin } from '../../../../../lib/orgs.js'
import { logAuditEvent } from '../../../../../lib/audit.js'

export const GET: APIRoute = async ({ params }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  const teams = await getOrgTeams(org.id)
  return new Response(JSON.stringify(teams), { headers: { 'Content-Type': 'application/json' } })
}

export const POST: APIRoute = async ({ params, request }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

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
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const body = await request.json()
  const { name } = body
  if (!name) return new Response(JSON.stringify({ error: 'name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

  try {
    const team = await createOrgTeam(org.id, name)

    // Log audit event
    logAuditEvent({
      orgId: org.id,
      userId,
      action: 'team.create',
      resourceType: 'team',
      resourceId: team.id,
      details: { name },
      ipAddress: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    }).catch(() => {})

    return new Response(JSON.stringify(team), { status: 201, headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    if (e.code === '23505') return new Response(JSON.stringify({ error: 'team already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ error: 'failed to create team' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
