import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getOrgBySlug, getOrgTeams, getTeamMembers, addTeamMember, removeTeamMember, isOrgAdmin } from '../../../../../../lib/orgs.js'

export const GET: APIRoute = async ({ params }) => {
  const { slug, name } = params
  if (!slug || !name) return new Response('Not found', { status: 404 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  const teams = await getOrgTeams(org.id)
  const team = teams.find(t => t.name === name)
  if (!team) return new Response('Not found', { status: 404 })

  const members = await getTeamMembers(team.id)
  return new Response(JSON.stringify(members), { headers: { 'Content-Type': 'application/json' } })
}

export const POST: APIRoute = async ({ params, request }) => {
  const { slug, name } = params
  if (!slug || !name) return new Response('Not found', { status: 404 })

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

  const teams = await getOrgTeams(org.id)
  const team = teams.find(t => t.name === name)
  if (!team) return new Response('Not found', { status: 404 })

  const body = await request.json()
  const { userId: targetUserId } = body
  if (!targetUserId) return new Response(JSON.stringify({ error: 'userId is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

  try {
    await addTeamMember(team.id, targetUserId)
    return new Response(null, { status: 201 })
  } catch (e: any) {
    if (e.code === '23505') return new Response(JSON.stringify({ error: 'user already on team' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ error: 'failed to add member' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export const DELETE: APIRoute = async ({ params, request }) => {
  const { slug, name } = params
  if (!slug || !name) return new Response('Not found', { status: 404 })

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

  const url = new URL(request.url)
  const targetUserId = url.searchParams.get('userId')
  if (!targetUserId) return new Response(JSON.stringify({ error: 'userId query param required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

  const teams = await getOrgTeams(org.id)
  const team = teams.find(t => t.name === name)
  if (!team) return new Response('Not found', { status: 404 })

  await removeTeamMember(team.id, targetUserId)
  return new Response(null, { status: 204 })
}
