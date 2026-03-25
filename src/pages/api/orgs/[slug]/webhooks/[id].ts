import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getOrgBySlug, isOrgAdmin } from '../../../../../lib/orgs.js'
import { updateWebhook, deleteWebhook } from '../../../../../lib/webhooks.js'
import { logAuditEvent } from '../../../../../lib/audit.js'

export const PUT: APIRoute = async ({ params, request }) => {
  const { slug, id } = params as { slug: string; id: string }
  if (!slug || !id) return new Response('Not found', { status: 404 })

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

  const body = await request.json().catch(() => ({}))
  const { url, events, active, secret } = body
  const updates: { url?: string; events?: string[]; active?: boolean; secret?: string } = {}

  if (url !== undefined) {
    if (typeof url !== 'string' || !url.startsWith('http')) {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    updates.url = url
  }
  if (events !== undefined) {
    if (!Array.isArray(events) || events.length === 0) {
      return new Response(JSON.stringify({ error: 'At least one event is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    updates.events = events
  }
  if (active !== undefined) updates.active = Boolean(active)
  if (secret !== undefined) updates.secret = String(secret)

  const webhook = await updateWebhook(id, updates)

  // Log audit event
  logAuditEvent({
    orgId: org.id,
    userId,
    action: 'webhook.update',
    resourceType: 'webhook',
    resourceId: id,
    details: updates,
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  }).catch(() => {})

  return new Response(JSON.stringify({ ...webhook, secret: undefined }), { headers: { 'Content-Type': 'application/json' } })
}

export const DELETE: APIRoute = async ({ params, request }) => {
  const { slug, id } = params as { slug: string; id: string }
  if (!slug || !id) return new Response('Not found', { status: 404 })

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

  await deleteWebhook(id)

  // Log audit event
  logAuditEvent({
    orgId: org.id,
    userId,
    action: 'webhook.delete',
    resourceType: 'webhook',
    resourceId: id,
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  }).catch(() => {})

  return new Response(null, { status: 204 })
}
