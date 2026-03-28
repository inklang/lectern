import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { resolveAuth, revokeKey, registerPublicKey } from '../../../lib/tokens.js'

export const GET: APIRoute = async ({ request }) => {
  const userId = await resolveAuth(request.headers.get('authorization'))
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Invalid or expired key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const { supabaseAnon } = await import('../../../lib/supabase.js')
  const { data: profile } = await supabaseAnon.from('users').select('username').eq('id', userId).single()
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

  // Web session: accept a publicKey body and register it
  let body: { publicKey?: string } = {}
  try { body = await request.json() } catch {}

  if (!body.publicKey) {
    return new Response(JSON.stringify({ error: 'Missing publicKey' }), { status: 400 })
  }

  const keyId = await registerPublicKey(session.user.id, body.publicKey)
  return new Response(JSON.stringify({ keyId }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const DELETE: APIRoute = async ({ request }) => {
  const ok = await revokeKey(request.headers.get('authorization'))
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Key not found or invalid signature' }), { status: 401 })
  }
  return new Response(null, { status: 204 })
}
