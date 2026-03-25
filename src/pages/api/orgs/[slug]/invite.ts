import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getOrgBySlug, isOrgAdmin, createInvite } from '../../../../lib/orgs.js'
import { logAuditEvent } from '../../../../lib/audit.js'

export const POST: APIRoute = async ({ params, request }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

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
  const { expiresInHours, maxUses } = body

  const invite = await createInvite(org.id, userId, expiresInHours, maxUses)

  // Log audit event
  logAuditEvent({
    orgId: org.id,
    userId,
    action: 'invite.create',
    resourceType: 'invite',
    resourceId: invite.token,
    details: { expiresInHours, maxUses },
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  }).catch(() => {})

  return new Response(JSON.stringify(invite), { status: 201, headers: { 'Content-Type': 'application/json' } })
}
