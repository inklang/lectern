import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { updatePackageWebhook, deletePackageWebhook, getPackageWebhook } from '../../../lib/webhooks.js'
import { logAuditEvent } from '../../../lib/audit.js'

export const PUT: APIRoute = async ({ params, request }) => {
  const { id } = params
  if (!id) return new Response('Not found', { status: 404 })

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

  const body = await request.json().catch(() => ({}))
  const { url, events, active } = body
  const updates: { url?: string; events?: string[]; active?: boolean } = {}

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
    const validEvents = ['package.starred', 'package.published', 'package.new_dependent']
    for (const ev of events) {
      if (!validEvents.includes(ev)) {
        return new Response(JSON.stringify({ error: `Invalid event: ${ev}` }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
    }
    updates.events = events
  }
  if (active !== undefined) updates.active = Boolean(active)

  // Verify the webhook belongs to this user
  const existing = await getPackageWebhook(id, user.id)
  if (!existing) return new Response('Not found', { status: 404 })

  const webhook = await updatePackageWebhook(id, user.id, updates)

  // Log audit event
  logAuditEvent({
    orgId: null,
    userId: user.id,
    action: 'webhook.update',
    resourceType: 'webhook_subscription',
    resourceId: id,
    details: updates,
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  }).catch(() => {})

  return new Response(JSON.stringify({ ...webhook, secret: undefined }), { headers: { 'Content-Type': 'application/json' } })
}

export const DELETE: APIRoute = async ({ params, request }) => {
  const { id } = params
  if (!id) return new Response('Not found', { status: 404 })

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

  // Verify the webhook belongs to this user
  const existing = await getPackageWebhook(id, user.id)
  if (!existing) return new Response('Not found', { status: 404 })

  await deletePackageWebhook(id, user.id)

  // Log audit event
  logAuditEvent({
    orgId: null,
    userId: user.id,
    action: 'webhook.delete',
    resourceType: 'webhook_subscription',
    resourceId: id,
    details: { package: existing.package_name },
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  }).catch(() => {})

  return new Response(null, { status: 204 })
}
