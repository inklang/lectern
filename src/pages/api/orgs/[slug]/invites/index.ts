import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../../lib/tokens.js'
import { getOrgBySlug, getOrgInvites, isOrgAdmin } from '../../../../../lib/orgs.js'

export const GET: APIRoute = async ({ params }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  const invites = await getOrgInvites(org.id)
  return new Response(JSON.stringify(invites), { headers: { 'Content-Type': 'application/json' } })
}
