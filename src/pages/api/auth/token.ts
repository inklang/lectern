import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { extractBearer, issueToken, resolveToken, revokeToken } from '../../../lib/tokens.js'

export const GET: APIRoute = async ({ request }) => {
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
  const userId = await resolveToken(raw)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
  const { supabase } = await import('../../../lib/supabase.js')
  const { data: profile } = await supabase.from('users').select('username').eq('id', userId).single()
  return new Response(JSON.stringify({ valid: true, username: profile?.username ?? null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const POST: APIRoute = async ({ request }) => {
  const supabase = createServerClient(
    import.meta.env.SUPABASE_URL ?? '',
    import.meta.env.SUPABASE_PUBLISHABLE_KEY ?? '',
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.headers.get('Cookie') ?? '')
        },
        setAll() {},
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const raw = await issueToken(session.user.id)
  return new Response(JSON.stringify({ token: raw }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const DELETE: APIRoute = async ({ request }) => {
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), { status: 401 })
  }

  const ok = await revokeToken(raw)
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Token not found' }), { status: 401 })
  }

  return new Response(null, { status: 204 })
}
