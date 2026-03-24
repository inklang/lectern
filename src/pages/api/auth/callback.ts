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

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '')
      },
      setAll() {},
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

  const cookieName = `${supabaseUrl.split('://')[1]}.auth-token`
  const cookieValue = encodeURIComponent(JSON.stringify(data.session))
  const maxAge = data.session.expires_in ?? 3600

  return new Response(null, {
    status: 302,
    headers: {
      Location: next,
      'Set-Cookie': `${cookieName}=${cookieValue}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`,
    },
  })
}
