import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
import { useInvite, addOrgMember, getOrgById } from '../../../../lib/orgs.js'

export const POST: APIRoute = async ({ request }) => {
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const body = await request.json()
  const { token } = body
  if (!token) return new Response(JSON.stringify({ error: 'token required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

  try {
    const result = await useInvite(token, userId)
    if (!result) return new Response(JSON.stringify({ error: 'invalid or expired invite' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

    // Check if already a member
    try {
      await addOrgMember(result.orgId, userId, 'member')
    } catch (e: any) {
      if (e.code !== '23505') throw e // re-throw if not "already member"
    }

    const org = await getOrgById(result.orgId)
    return new Response(JSON.stringify({ org }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'failed to join org' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
