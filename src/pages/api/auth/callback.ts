import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'

export const GET: APIRoute = async ({ request, cookies, redirect }) => {
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
      setAll() {
        // handled below via cookies.set()
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

  const supabaseCookieName = `${supabaseUrl.split('://')[1]}.auth-token`
  const cookieValue = JSON.stringify(data.session)

  cookies.set(supabaseCookieName, cookieValue, {
    maxAge: data.session.expires_in,
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
  })

  return redirect(next)
}
