import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
import { getOrgBySlug, isOrgAdmin } from '../../../../lib/orgs.js'
import { listWebhooks, createWebhook } from '../../../../lib/webhooks.js'
import { logAuditEvent } from '../../../../lib/audit.js'
import { randomBytes } from 'crypto'

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

  const webhooks = await listWebhooks(org.id)
  // Don't expose secrets to clients
  const sanitized = webhooks.map(w => ({ ...w, secret: undefined }))
  return new Response(JSON.stringify(sanitized), { headers: { 'Content-Type': 'application/json' } })
}

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
  const { url, events } = body

  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return new Response(JSON.stringify({ error: 'Valid URL is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (!Array.isArray(events) || events.length === 0) {
    return new Response(JSON.stringify({ error: 'At least one event is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Generate a random secret for HMAC verification
  const secret = randomBytes(32).toString('hex')

  const webhook = await createWebhook(org.id, url, events, secret)

  // Log audit event
  logAuditEvent({
    orgId: org.id,
    userId,
    action: 'webhook.create',
    resourceType: 'webhook',
    resourceId: webhook.id,
    details: { url, events },
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  }).catch(() => {})

  return new Response(JSON.stringify({ ...webhook, secret }), { status: 201, headers: { 'Content-Type': 'application/json' } })
}
