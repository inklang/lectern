import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { canUserPublish } from '../../../lib/authz.js'
import { listPackageWebhooks, createPackageWebhook } from '../../../lib/webhooks.js'
import { logAuditEvent } from '../../../lib/audit.js'
import { randomBytes } from 'crypto'

export const GET: APIRoute = async ({ request }) => {
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

  // Optional filter by package
  const url = new URL(request.url)
  const packageName = url.searchParams.get('package')

  let webhooks = await listPackageWebhooks(user.id)

  // Filter by package if specified
  if (packageName) {
    webhooks = webhooks.filter(w => w.package_name === packageName)
  }

  // Don't expose secrets
  const sanitized = webhooks.map(w => ({ ...w, secret: undefined }))
  return new Response(JSON.stringify(sanitized), {
    headers: { 'Content-Type': 'application/json' },
  })
}

export const POST: APIRoute = async ({ request }) => {
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
  const { packageName, url, events } = body

  if (!packageName || typeof packageName !== 'string') {
    return new Response(JSON.stringify({ error: 'packageName is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return new Response(JSON.stringify({ error: 'Valid URL is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (!Array.isArray(events) || events.length === 0) {
    return new Response(JSON.stringify({ error: 'At least one event is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Validate event types
  const validEvents = ['package.starred', 'package.published', 'package.new_dependent']
  for (const ev of events) {
    if (!validEvents.includes(ev)) {
      return new Response(JSON.stringify({ error: `Invalid event: ${ev}` }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
  }

  // Verify user can publish to this package (i.e., is an owner/maintainer)
  // The package slug is in format "owner/packageName" - we need to find the package
  // Try to find the package by short name matching the last segment
  const { data: pkg } = await supabase
    .from('packages')
    .select('slug, owner_id, owner_type')
    .ilike('name', packageName)
    .single()

  if (!pkg) {
    return new Response(JSON.stringify({ error: 'Package not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  }

  // Check authorization using canUserPublish
  if (!(await canUserPublish(user.id, pkg.slug))) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }

  // Generate a random secret for HMAC verification
  const secret = randomBytes(32).toString('hex')

  const webhook = await createPackageWebhook(user.id, packageName, url, events, secret)

  // Log audit event
  logAuditEvent({
    orgId: null,
    userId: user.id,
    action: 'webhook.create',
    resourceType: 'webhook_subscription',
    resourceId: webhook.id,
    details: { package: packageName, url, events },
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  }).catch(() => {})

  return new Response(JSON.stringify({ id: webhook.id, secret }), { status: 201, headers: { 'Content-Type': 'application/json' } })
}
