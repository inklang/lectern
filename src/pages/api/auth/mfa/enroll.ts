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

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
  })

  if (error) {
    const errMsg = error.message || ''

    if (errMsg.toLowerCase().includes('already exists')) {
      const factorsRes = await supabase.auth.mfa.listFactors()

      if (factorsRes.error || !factorsRes.data?.factors || factorsRes.data.factors.length === 0) {
        return new Response(JSON.stringify({ error: 'MFA factor exists but cannot list it. Please sign out and sign back in, then try again.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const totpFactors = factorsRes.data.factors.filter((f: any) => f.factor_type === 'totp')

      for (const f of totpFactors) {
        if (f.status === 'verified') {
          return new Response(JSON.stringify({ error: 'MFA is already enabled. Remove it first if you want to add a new one.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }

      const retryRes = await supabase.auth.mfa.enroll({ factorType: 'totp' })

      if (retryRes.error || !retryRes.data) {
        return new Response(JSON.stringify({ error: retryRes.error?.message ?? 'Failed to enroll after cleanup' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Supabase returns qr_code (snake_case)
      const retryData = retryRes.data as any
      return new Response(JSON.stringify({
        id: retryData.id,
        qrCode: retryData.qr_code,
        secret: retryData.secret,
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: errMsg || 'Enrollment failed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!data) {
    return new Response(JSON.stringify({ error: 'Failed to enroll MFA' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Supabase returns qr_code (snake_case)
  const enrollData = data as any
  return new Response(JSON.stringify({
    id: enrollData.id,
    qrCode: enrollData.qr_code,
    secret: enrollData.secret,
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
