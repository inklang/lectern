import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'

export const GET: APIRoute = async ({ request, cookies, redirect }) => {
  const url = new URL(request.url)
  const supabaseUrl = url.protocol + '//' + url.host

  const supabase = createServerClient(
    import.meta.env.SUPABASE_URL ?? '',
    import.meta.env.SUPABASE_SECRET_KEY ?? '',
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.headers.get('Cookie') ?? '')
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${supabaseUrl}/api/auth/callback`,
    },
  })

  if (error) {
    return redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  return redirect(data.url)
}
