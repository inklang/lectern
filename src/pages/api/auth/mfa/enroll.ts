import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export const POST: APIRoute = async ({ request }) => {
  const supabaseUrl = import.meta.env.SUPABASE_URL
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
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

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const userId = session.user.id

  // First, list existing factors
  const factorsRes = await supabase.auth.mfa.listFactors()
  console.error('DEBUG listFactors:', JSON.stringify(factorsRes))

  const totpFactors = factorsRes.data?.factors?.filter((f: any) => f.factor_type === 'totp') ?? []

  if (totpFactors.length > 0) {
    const verifiedFactors = totpFactors.filter((f: any) => f.status === 'verified')
    if (verifiedFactors.length > 0) {
      return new Response(JSON.stringify({ error: 'MFA is already enabled on your account.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // Has unverified factors - try to delete them first
    for (const f of totpFactors) {
      console.error('DEBUG unenrolling factor:', f.id)
      const unenrollRes = await supabase.auth.mfa.unenroll({ factorId: f.id })
      console.error('DEBUG unenroll result:', JSON.stringify(unenrollRes))
    }
  }

  // Now try to enroll - if unverified factors remain, Supabase will return existing ones
  const enrollResult = await supabase.auth.mfa.enroll({
    factorType: 'totp',
  })

  console.error('DEBUG enroll error:', enrollResult.error)
  console.error('DEBUG enroll data:', JSON.stringify(enrollResult.data))

  // Refresh session to pick up new factor
  const { data: refreshedSession } = await supabase.auth.getSession()
  console.error('DEBUG session after enroll:', refreshedSession ? 'has session' : 'no session')

  // List factors to verify factor was created
  const factorsAfterEnroll = await supabase.auth.mfa.listFactors()
  console.error('DEBUG factors after enroll:', JSON.stringify(factorsAfterEnroll))
  console.error('DEBUG enroll data keys:', enrollResult.data ? Object.keys(enrollResult.data) : 'no data')
  console.error('DEBUG enroll data:', JSON.stringify(enrollResult.data))
  console.error('DEBUG enroll id:', enrollResult.data?.id)
  console.error('DEBUG enroll qrCode type:', typeof enrollResult.data?.qrCode)
  console.error('DEBUG enroll qrCode length:', enrollResult.data?.qrCode?.length)
  console.error('DEBUG enroll qr_code:', enrollResult.data?.qr_code)
  console.error('DEBUG enroll secret:', enrollResult.data?.secret)

  if (enrollResult.error) {
    if (enrollResult.error.message?.toLowerCase().includes('already exists')) {
      // Factor already exists - use admin query to bypass SSR session issues
      // The service role key bypasses RLS so we can query directly
      const adminClient = createClient(supabaseUrl, supabaseKey)
      const { data: factorsData, error: factorsError } = await adminClient.from('auth.mfa_factors').select('*').eq('user_id', userId)

      console.error('DEBUG admin query factors:', { factorsData, factorsError })

      let verifiedFactors: any[] = []
      let unverifiedFactors: any[] = []

      if (factorsData && !factorsError) {
        verifiedFactors = factorsData.filter((f: any) => f.status === 'verified')
        unverifiedFactors = factorsData.filter((f: any) => f.status === 'unverified')
      }
      if (verifiedFactors.length > 0) {
        // User already has a verified factor
        const headers = new Headers({ 'Content-Type': 'application/json' })
        cookiesToSet.forEach(({ name, value, options }) => {
          const maxAge = typeof options['maxAge'] === 'number' ? options['maxAge'] : 3600
          const path = typeof options['path'] === 'string' ? options['path'] : '/'
          const sameSite = typeof options['sameSite'] === 'string' ? options['sameSite'] : 'Lax'
          let cookie = `${name}=${value}; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite}`
          if (options['secure']) cookie += '; Secure'
          headers.append('Set-Cookie', cookie)
        })
        return new Response(JSON.stringify({
          existing: true,
          verified: true,
          id: verifiedFactors[0].id,
        }), {
          status: 200,
          headers,
        })
      }
      if (unverifiedFactors.length > 0) {
        // Has unverified factor
        const headers = new Headers({ 'Content-Type': 'application/json' })
        cookiesToSet.forEach(({ name, value, options }) => {
          const maxAge = typeof options['maxAge'] === 'number' ? options['maxAge'] : 3600
          const path = typeof options['path'] === 'string' ? options['path'] : '/'
          const sameSite = typeof options['sameSite'] === 'string' ? options['sameSite'] : 'Lax'
          let cookie = `${name}=${value}; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite}`
          if (options['secure']) cookie += '; Secure'
          headers.append('Set-Cookie', cookie)
        })
        return new Response(JSON.stringify({
          existing: true,
          verified: false,
          id: unverifiedFactors[0].id,
        }), {
          status: 200,
          headers,
        })
      }
      return new Response(JSON.stringify({
        error: 'MFA enrollment failed. Please sign out, sign back in, and try again.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: enrollResult.error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!enrollResult.data) {
    return new Response(JSON.stringify({ error: 'Failed to enroll MFA' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Supabase returns qr_code nested under totp (e.g., data.totp.qr_code)
  const enrollData = enrollResult.data as any
  return new Response(JSON.stringify({
    id: enrollData.id,
    qrCode: enrollData.totp?.qr_code,
    secret: enrollData.totp?.secret,
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
