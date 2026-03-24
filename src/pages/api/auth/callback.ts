import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/profile'
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  if (error) {
    return Response.redirect(
      new URL(`/login?error=${encodeURIComponent(errorDescription ?? error)}`, url).toString(),
      302
    )
  }

  if (!code) {
    return Response.redirect(new URL('/login?error=no_code', url).toString(), 302)
  }

  const supabaseUrl = import.meta.env.SUPABASE_URL
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseKey) {
    return Response.redirect(new URL('/login?error=server_config', url).toString(), 302)
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '')
      },
      setAll(cookiesToSet) {
        // Handled below - serialize cookies into the response directly
      },
    },
  })

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    console.error('OAuth callback error:', exchangeError)
    return Response.redirect(
      new URL(`/login?error=${encodeURIComponent(exchangeError.message)}`, url).toString(),
      302
    )
  }

  if (!data.session) {
    return Response.redirect(new URL('/login?error=no_session', url).toString(), 302)
  }

  // Serialize cookies manually to include in the redirect response
  const setCookieHeaders: string[] = []
  const cookieOptions = {
    maxAge: data.session.expires_in,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: true,
    path: '/',
  }

  // Access token cookie
  setCookieHeaders.push(
    serializeCookieHeader(
      `${supabaseUrl.split('://')[1]}.auth-token`,
      JSON.stringify(data.session),
      cookieOptions
    )
  )

  return new Response(null, {
    status: 302,
    headers: {
      Location: next,
      'Set-Cookie': setCookieHeaders.join(', '),
    },
  })
}
