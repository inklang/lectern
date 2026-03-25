import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getOrgBySlug, cancelInvite, isOrgAdmin } from '../../../../../../lib/orgs.js'
import { logAuditEvent } from '../../../../../../lib/audit.js'

export const DELETE: APIRoute = async ({ params, request }) => {
  const { slug, token } = params
  if (!slug || !token) return new Response('Not found', { status: 404 })

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
