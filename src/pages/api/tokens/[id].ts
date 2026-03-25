import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getApiToken, revokeApiToken } from '../../../lib/api-tokens.js'
import { logAuditEvent } from '../../../lib/audit.js'

export const GET: APIRoute = async ({ params, request }) => {
  const { id } = params
  if (!id) return new Response(JSON.stringify({ error: 'Token ID required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY ?? ''

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() { return parseCookieHeader(request.headers.get('Cookie') ?? '') },
      setAll() {},
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })

  try {
    const token = await getApiToken(id, user.id)
    if (!token) {
      return new Response(JSON.stringify({ error: 'Token not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({
      id: token.id,
      name: token.name,
      tokenPrefix: token.token_prefix,
      scopes: token.scopes,
      tokenType: token.token_type,
      expiresAt: token.expires_at,
      rateLimit: token.rate_limit,
      lastUsedAt: token.last_used_at,
      createdAt: token.created_at,
    }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('Failed to get API token:', err)
    return new Response(JSON.stringify({ error: 'Failed to get token' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export const DELETE: APIRoute = async ({ params, request }) => {
  const { id } = params
  if (!id) return new Response(JSON.stringify({ error: 'Token ID required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY ?? ''

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() { return parseCookieHeader(request.headers.get('Cookie') ?? '') },
      setAll() {},
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })

  try {
    // Get token first for audit log
    const token = await getApiToken(id, user.id)
    if (!token) {
      return new Response(JSON.stringify({ error: 'Token not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }

    const ok = await revokeApiToken(id, user.id)
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Failed to revoke token' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    // Log audit event
    logAuditEvent({
      userId: user.id,
      action: 'token.revoke',
      resourceType: 'api_token',
      resourceId: id,
      details: {
        tokenName: token.name,
        tokenPrefix: token.token_prefix,
      },
      ipAddress: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    }).catch(() => {})

    return new Response(null, { status: 204 })
  } catch (err) {
    console.error('Failed to revoke API token:', err)
    return new Response(JSON.stringify({ error: 'Failed to revoke token' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
