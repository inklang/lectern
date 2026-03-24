import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'

export const POST: APIRoute = async ({ request }) => {
  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY ?? ''

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '')
      },
      setAll() {},
    },
  })

  await supabase.auth.signOut()

  const cookieName = `${supabaseUrl.split('://')[1]}.auth-token`

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`,
    },
  })
}
