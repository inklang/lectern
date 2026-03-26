import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'

export const POST: APIRoute = async ({ request }) => {
  const url = new URL(request.url)
  const supabaseUrl = url.protocol + '//' + url.host

  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { email?: string; password?: string } = {}
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { email, password } = body
  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'Email and password are required' }), {
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

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.session) {
    return new Response(JSON.stringify({ error: error?.message ?? 'Invalid credentials' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check if user has MFA factors enrolled
  const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors()

  if (!factorsError && factorsData?.factors && factorsData.factors.length > 0) {
    const verifiedFactors = factorsData.factors.filter((f: any) => f.status === 'verified')
    if (verifiedFactors.length > 0) {
      // User has MFA enrolled, return factor ID for verification
      return new Response(JSON.stringify({
        mfaRequired: true,
        factorId: verifiedFactors[0].id,
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // No MFA, set cookies and return success
  const headers = new Headers({ 'Content-Type': 'application/json' })
  cookiesToSet.forEach(({ name, value, options }) => {
    const maxAge = typeof options['maxAge'] === 'number' ? options['maxAge'] : (data.session.expires_in ?? 3600)
    const path = typeof options['path'] === 'string' ? options['path'] : '/'
    const sameSite = typeof options['sameSite'] === 'string' ? options['sameSite'] : 'Lax'
    let cookie = `${name}=${value}; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite}`
    if (options['secure']) cookie += '; Secure'
    headers.append('Set-Cookie', cookie)
  })

  return new Response(JSON.stringify({
    success: true,
    user: { id: data.user.id, email: data.user.email },
  }), { headers })
}
