import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
import { getOrgBySlug, isOrgAdmin } from '../../../../lib/orgs.js'
import { queryAuditLog } from '../../../../lib/audit.js'
import type { AuditAction } from '../../../../lib/audit.js'

export const GET: APIRoute = async ({ params, request }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  // Parse query params
  const url = new URL(request.url)
  const action = url.searchParams.get('action') as AuditAction | null
  const resourceType = url.searchParams.get('resourceType') ?? undefined
  const resourceId = url.searchParams.get('resourceId') ?? undefined
  const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from')!) : undefined
  const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : undefined
  const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : 50
  const offset = url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!) : 0

  const result = await queryAuditLog({
    orgId: org.id,
    action: action ?? undefined,
    resourceType,
    resourceId,
    from,
    to,
    limit,
    offset,
  })

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}
