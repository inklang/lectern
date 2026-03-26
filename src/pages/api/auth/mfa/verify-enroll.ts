import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'

export const POST: APIRoute = async ({ request }) => {
  const supabaseUrl = import.meta.env.SUPABASE_URL
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { factorId?: string; challengeId?: string; code?: string } = {}
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { factorId, challengeId, code } = body
  if (!factorId || !challengeId || !code) {
    return new Response(JSON.stringify({ error: 'factorId, challengeId, and code are required' }), {
      status: 400,
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

  console.error('DEBUG verify-enroll input:', { factorId, challengeId, code })

  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    code,
  })

  console.error('DEBUG verify-enroll result:', JSON.stringify({ data, error }))

  // Refresh session after MFA verification
  if (!error) {
    const { data: refreshedSession } = await supabase.auth.getSession()
    console.error('DEBUG session after MFA verify:', refreshedSession ? 'has session' : 'no session')
    const factorsAfterVerify = await supabase.auth.mfa.listFactors()
    console.error('DEBUG factors after verify:', JSON.stringify(factorsAfterVerify))
  }

  if (error) {
    console.error('DEBUG verify-enroll error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ verified: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
