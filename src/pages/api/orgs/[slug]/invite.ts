import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
import { getOrgBySlug, isOrgAdmin, createInvite } from '../../../../lib/orgs.js'

export const POST: APIRoute = async ({ params, request }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { expiresInHours, maxUses } = body

  const invite = await createInvite(org.id, userId, expiresInHours, maxUses)
  return new Response(JSON.stringify(invite), { status: 201, headers: { 'Content-Type': 'application/json' } })
}
