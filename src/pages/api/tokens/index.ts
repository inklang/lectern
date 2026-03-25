import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { issueApiToken, listApiTokens } from '../../../lib/api-tokens.js'
import { logAuditEvent } from '../../../lib/audit.js'

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
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  const userId = user.id

  const body = await request.json().catch(() => null)
  if (!body) return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

  const { name, description, scopes, expiresIn, rateLimit, orgId } = body

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (name.length > 64) {
    return new Response(JSON.stringify({ error: 'Name must be 64 characters or less' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (description && typeof description === 'string' && description.length > 256) {
    return new Response(JSON.stringify({ error: 'Description must be 256 characters or less' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Validate scopes
  const validScopes = [
    'packages_read', 'packages_publish', 'packages_delete',
    'orgs_read', 'orgs_manage', 'orgs_delete',
    'teams_read', 'teams_manage',
    'tokens_read', 'tokens_write',
  ]

  const tokenScopes = {
    packages_read: false,
    packages_publish: false,
    packages_delete: false,
    orgs_read: false,
    orgs_manage: false,
    orgs_delete: false,
    teams_read: false,
    teams_manage: false,
    tokens_read: false,
    tokens_write: false,
    ...scopes,
  }

  // Validate scope keys
  for (const key of Object.keys(tokenScopes)) {
    if (!validScopes.includes(key)) {
      return new Response(JSON.stringify({ error: `Invalid scope: ${key}` }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (typeof tokenScopes[key as keyof typeof tokenScopes] !== 'boolean') {
      return new Response(JSON.stringify({ error: `Scope ${key} must be a boolean` }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
  }

  // Validate scope combinations
  if (tokenScopes.packages_delete && !tokenScopes.packages_publish) {
    return new Response(JSON.stringify({ error: 'packages_delete requires packages_publish' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (tokenScopes.orgs_delete && !tokenScopes.orgs_manage) {
    return new Response(JSON.stringify({ error: 'orgs_delete requires orgs_manage' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Validate expiration
  const expiresInSeconds = expiresIn ? Number(expiresIn) : null
  if (expiresInSeconds !== null && (isNaN(expiresInSeconds) || expiresInSeconds < 0)) {
    return new Response(JSON.stringify({ error: 'Invalid expiresIn value' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Validate rate limit
  const rateLimitValue = rateLimit ? Number(rateLimit) : null
  if (rateLimitValue !== null && ![10, 100, 1000].includes(rateLimitValue)) {
    return new Response(JSON.stringify({ error: 'Rate limit must be 10, 100, or 1000' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const { token, raw } = await issueApiToken(userId, name.trim(), tokenScopes, {
      description: description?.trim() || undefined,
      expiresIn: expiresInSeconds,
      rateLimit: rateLimitValue,
      orgId: orgId || null,
    })

    // Log audit event
    logAuditEvent({
      userId,
      action: 'token.create',
      resourceType: 'api_token',
      resourceId: token.id,
      details: {
        tokenName: token.name,
        tokenPrefix: token.token_prefix,
        scopes: token.scopes,
        orgId: token.org_id,
        expiresAt: token.expires_at,
      },
      ipAddress: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    }).catch(() => {})

    return new Response(JSON.stringify({
      id: token.id,
      name: token.name,
      token: raw,
      tokenPrefix: token.token_prefix,
      scopes: token.scopes,
      tokenType: token.token_type,
      expiresAt: token.expires_at,
      rateLimit: token.rate_limit,
      createdAt: token.created_at,
    }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('Failed to create API token:', err)
    return new Response(JSON.stringify({ error: 'Failed to create token' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

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
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })

  try {
    const tokens = await listApiTokens(user.id)

    return new Response(JSON.stringify({
      tokens: tokens.map(t => ({
        id: t.id,
        name: t.name,
        tokenPrefix: t.token_prefix,
        scopes: t.scopes,
        tokenType: t.token_type,
        expiresAt: t.expires_at,
        rateLimit: t.rate_limit,
        lastUsedAt: t.last_used_at,
        createdAt: t.created_at,
      })),
    }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('Failed to list API tokens:', err)
    return new Response(JSON.stringify({ error: 'Failed to list tokens' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
