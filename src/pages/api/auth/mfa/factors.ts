import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'

export const GET: APIRoute = async ({ request }) => {
  const supabaseUrl = import.meta.env.SUPABASE_URL
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
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

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // listFactors is a user-level method, use the authenticated client
  const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors()

  console.error('DEBUG factors listFactors result:', JSON.stringify({ factorsData, factorsError }))
  console.error('DEBUG factors session:', JSON.stringify(session ? { user_id: session.user.id } : 'no session'))

  if (factorsError) {
    console.error('listFactors error:', factorsError)
    return new Response(JSON.stringify({ error: factorsError.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  console.error('DEBUG factors raw data:', JSON.stringify(factorsData))
  const factors = (factorsData?.factors ?? []).map((f: any) => ({
    id: f.id,
    factorType: f.factor_type,
    status: f.status,
    createdAt: f.created_at,
  }))

  return new Response(JSON.stringify(factors), {
    headers: { 'Content-Type': 'application/json' },
  })
}
