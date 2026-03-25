import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../../../lib/tokens.js'
import { getOrgBySlug, cancelInvite, isOrgAdmin } from '../../../../../../lib/orgs.js'
import { logAuditEvent } from '../../../../../../lib/audit.js'

export const DELETE: APIRoute = async ({ params, request }) => {
  const { slug, token } = params
  if (!slug || !token) return new Response('Not found', { status: 404 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  // Only admins/owners can cancel invites
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  try {
    await cancelInvite(org.id, token)

    // Log audit event
    logAuditEvent({
      orgId: org.id,
      userId,
      action: 'invite.cancel',
      resourceType: 'invite',
      resourceId: token,
      ipAddress: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    }).catch(() => {})

    return new Response(null, { status: 204 })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'failed to cancel invite' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
