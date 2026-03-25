import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { useInvite, addOrgMember, getOrgById } from '../../../../lib/orgs.js'
import { logAuditEvent } from '../../../../lib/audit.js'

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
  const userId = user.id

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

    // Log audit event
    logAuditEvent({
      orgId: result.orgId,
      userId,
      action: 'invite.accept',
      resourceType: 'member',
      resourceId: userId,
      details: { orgSlug: org.slug },
      ipAddress: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    }).catch(() => {})

    return new Response(JSON.stringify({ org }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'failed to join org' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
