import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { extractBearer, issueToken, revokeToken } from '../../../lib/tokens.js'

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
