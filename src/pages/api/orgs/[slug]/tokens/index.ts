import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getOrgBySlug, isOrgAdmin } from '../../../../lib/orgs.js'
import { listOrgApiTokens, revokeOrgApiToken } from '../../../../lib/api-tokens.js'
import { logAuditEvent } from '../../../../lib/audit.js'

export const GET: APIRoute = async ({ params, request }) => {
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

  try {
    const tokens = await listOrgApiTokens(org.id)

    return new Response(JSON.stringify({
      tokens: tokens.map(t => ({
        id: t.id,
        name: t.name,
        userId: t.user_id,
        userEmail: t.user_email,
        tokenPrefix: t.token_prefix,
        scopes: t.scopes,
        expiresAt: t.expires_at,
        lastUsedAt: t.last_used_at,
        createdAt: t.created_at,
      })),
    }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('Failed to list org API tokens:', err)
    return new Response(JSON.stringify({ error: 'Failed to list tokens' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

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
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const url = new URL(request.url)
  const tokenId = url.searchParams.get('id')
  if (!tokenId) return new Response(JSON.stringify({ error: 'Token ID required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

  try {
    const ok = await revokeOrgApiToken(tokenId, org.id, userId)
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Failed to revoke token' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    // Log audit event
    logAuditEvent({
      orgId: org.id,
      userId,
      action: 'token.revoke',
      resourceType: 'api_token',
      resourceId: tokenId,
      details: {
        orgSlug: slug,
      },
      ipAddress: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    }).catch(() => {})

    return new Response(null, { status: 204 })
  } catch (err) {
    console.error('Failed to revoke org API token:', err)
    return new Response(JSON.stringify({ error: 'Failed to revoke token' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
