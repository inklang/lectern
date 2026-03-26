import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'

export const POST: APIRoute = async ({ request }) => {
  const supabaseUrl = import.meta.env.SUPABASE_URL
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { factorId?: string; challengeId?: string; code?: string } = {}
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { factorId, challengeId, code } = body
  if (!factorId || !challengeId || !code) {
    return new Response(JSON.stringify({ error: 'factorId, challengeId, and code are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[] = []

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '')
      },
      setAll(cookies) {
        cookiesToSet.push(...cookies)
      },
    },
  })

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  console.error('DEBUG verify-enroll input:', { factorId, challengeId, code })

  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    code,
  })

  console.error('DEBUG verify-enroll result:', JSON.stringify({ data, error }))

  if (error) {
    console.error('DEBUG verify-enroll error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // After successful MFA verification, refresh the session to pick up the updated factors
  const { data: { session: refreshedSession }, error: refreshError } = await supabase.auth.refreshSession()
  console.error('DEBUG refreshSession result:', { refreshError, hasSession: !!refreshedSession })

  // Build response with cookies set properly
  const headers = new Headers({ 'Content-Type': 'application/json' })
  cookiesToSet.forEach(({ name, value, options }) => {
    const maxAge = typeof options['maxAge'] === 'number' ? options['maxAge'] : 3600
    const path = typeof options['path'] === 'string' ? options['path'] : '/'
    const sameSite = typeof options['sameSite'] === 'string' ? options['sameSite'] : 'Lax'
    let cookie = `${name}=${value}; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite}`
    if (options['secure']) cookie += '; Secure'
    headers.append('Set-Cookie', cookie)
  })

  return new Response(JSON.stringify({ verified: true }), {
    headers,
  })
}
