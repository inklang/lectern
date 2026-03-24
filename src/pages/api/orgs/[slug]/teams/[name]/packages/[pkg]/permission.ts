import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../../../../../lib/tokens.js'
import { getOrgBySlug, getOrgTeams, setPackagePermission, isOrgAdmin } from '../../../../../../../../lib/orgs.js'

export const PUT: APIRoute = async ({ params, request }) => {
  const { slug, name, pkg } = params
  if (!slug || !name || !pkg) return new Response('Not found', { status: 404 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const teams = await getOrgTeams(org.id)
  const team = teams.find(t => t.name === name)
  if (!team) return new Response('Not found', { status: 404 })

  const body = await request.json()
  const { permission } = body
  if (permission && !['read', 'write', 'admin'].includes(permission)) {
    return new Response(JSON.stringify({ error: 'invalid permission' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  await setPackagePermission(team.id, pkg, permission ?? null)
  return new Response(null, { status: 204 })
}
