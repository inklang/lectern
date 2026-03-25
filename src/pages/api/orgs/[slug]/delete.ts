import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getOrgBySlug, deleteOrg, isOrgOwner } from '../../../../lib/orgs.js'
import { logAuditEvent } from '../../../../lib/audit.js'
import { deleteOrgAsset } from '../../../../lib/storage.js'

export const DELETE: APIRoute = async ({ params, request }) => {
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

  // Only org owner can delete the org
  if (!(await isOrgOwner(org.id, userId))) return new Response('Forbidden', { status: 403 })

  try {
    // Delete org assets from storage (ignore errors if they don't exist)
    await deleteOrgAsset(org.id, 'avatar').catch(() => {})
    await deleteOrgAsset(org.id, 'banner').catch(() => {})

    await deleteOrg(org.id)

    // Log audit event
    logAuditEvent({
      orgId: org.id,
      userId,
      action: 'org.delete',
      resourceType: 'org',
      resourceId: org.id,
      details: { slug, name: org.name },
      ipAddress: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    }).catch(() => {})

    return new Response(null, { status: 204 })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'failed to delete org' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
