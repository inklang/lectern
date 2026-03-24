import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'

export const GET: APIRoute = async ({ request, redirect }) => {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/profile'
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  if (error) {
    return redirect(`/login?error=${encodeURIComponent(errorDescription ?? error)}`)
  }

  if (!code) {
    return redirect('/login?error=no_code')
  }

  const supabaseUrl = import.meta.env.SUPABASE_URL
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseKey) {
    return redirect('/login?error=server_config')
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '')
      },
      setAll(cookiesToSet) {
        // Can't modify the request headers - we handle this via the
        // Response cookies below by capturing the session from exchangeCodeForSession
      },
    },
  })

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    console.error('OAuth callback error:', exchangeError)
    return redirect(`/login?error=${encodeURIComponent(exchangeError.message)}`)
  }

  if (!data.session) {
    return redirect('/login?error=no_session')
  }

  // Manually construct the redirect with Set-Cookie headers from the session
  const sessionCookieName = `${supabaseUrl.split('://')[1]}.auth-token`
  const sessionCookie = `${sessionCookieName}=${encodeURIComponent(JSON.stringify(data.session))}; Path=/; Max-Age=${data.session.expires_in}; HttpOnly; SameSite=Lax; Secure`

  return new Response(null, {
    status: 302,
    headers: {
      Location: next,
      'Set-Cookie': sessionCookie,
    },
  })
}
