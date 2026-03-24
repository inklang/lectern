import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/profile'
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  if (error) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/login?error=${encodeURIComponent(errorDescription ?? error)}` },
    })
  }

  if (!code) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/login?error=no_code' },
    })
  }

  const supabaseUrl = import.meta.env.SUPABASE_URL
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseKey) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/login?error=server_config' },
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

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError || !data.session) {
    console.error('OAuth callback error:', exchangeError)
    return new Response(null, {
      status: 302,
      headers: { Location: `/login?error=${encodeURIComponent(exchangeError?.message ?? 'exchange_failed')}` },
    })
  }

  const headers = new Headers({ Location: next })
  cookiesToSet.forEach(({ name, value, options }) => {
    const maxAge = typeof options['maxAge'] === 'number' ? options['maxAge'] : (data.session.expires_in ?? 3600)
    const path = typeof options['path'] === 'string' ? options['path'] : '/'
    const sameSite = typeof options['sameSite'] === 'string' ? options['sameSite'] : 'Lax'
    // No HttpOnly — profile page reads session via document.cookie in the browser
    let cookie = `${name}=${value}; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite}`
    if (options['secure']) cookie += '; Secure'
    headers.append('Set-Cookie', cookie)
  })

  return new Response(null, { status: 302, headers })
}
