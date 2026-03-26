import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'

export const POST: APIRoute = async ({ request }) => {
  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY ?? ''

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

  await supabase.auth.signOut()

  // Clear all cookies
  const headers = new Headers({ Location: '/' })
  cookiesToSet.forEach(({ name, value, options }) => {
    const maxAge = 0
    const path = typeof options['path'] === 'string' ? options['path'] : '/'
    const sameSite = typeof options['sameSite'] === 'string' ? options['sameSite'] : 'Lax'
    let cookie = `${name}=; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite}`
    if (options['secure']) cookie += '; Secure'
    headers.append('Set-Cookie', cookie)
  })

  return new Response(null, {
    status: 302,
    headers,
  })
}
