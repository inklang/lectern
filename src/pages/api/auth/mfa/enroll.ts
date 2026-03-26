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

  const enrollResult = await supabase.auth.mfa.enroll({
    factorType: 'totp',
  })

  console.error('=== MFA ENROLL FULL RESULT ===')
  console.error('error:', enrollResult.error ? JSON.stringify(enrollResult.error) : 'none')
  console.error('data type:', typeof enrollResult.data)
  console.error('data:', enrollResult.data)
  console.error('data constructor:', enrollResult.data?.constructor?.name)
  console.error('data keys:', enrollResult.data ? Object.keys(enrollResult.data) : 'n/a')
  console.error('===========================')

  if (enrollResult.error) {
    const errMsg = enrollResult.error.message || ''

    if (errMsg.toLowerCase().includes('already exists')) {
      const factorsRes = await supabase.auth.mfa.listFactors()

      if (factorsRes.error || !factorsRes.data?.factors || factorsRes.data.factors.length === 0) {
        return new Response(JSON.stringify({ error: 'MFA factor exists but cannot list it.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const totpFactors = factorsRes.data.factors.filter((f: any) => f.factor_type === 'totp')

      for (const f of totpFactors) {
        if (f.status === 'verified') {
          return new Response(JSON.stringify({ error: 'MFA is already enabled.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }

      const retryResult = await supabase.auth.mfa.enroll({ factorType: 'totp' })

      console.error('=== MFA RETRY RESULT ===')
      console.error('retry error:', retryResult.error ? JSON.stringify(retryResult.error) : 'none')
      console.error('retry data:', retryResult.data)
      console.error('retry data keys:', retryResult.data ? Object.keys(retryResult.data) : 'n/a')
      console.error('========================')

      if (retryResult.error || !retryResult.data) {
        return new Response(JSON.stringify({ error: retryResult.error?.message ?? 'Failed to enroll after cleanup' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({
        id: retryResult.data.id,
        qrCode: retryResult.data.qrCode || retryResult.data.qr_code,
        secret: retryResult.data.secret,
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: errMsg || 'Enrollment failed' }), {
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

  // Try both field names
  const qrCode = enrollResult.data.qrCode || enrollResult.data.qr_code

  if (!qrCode) {
    console.error('QR CODE MISSING! Dumping all data:')
    console.error(JSON.stringify(enrollResult.data, null, 2))
    return new Response(JSON.stringify({ error: 'Failed to get QR code from Supabase. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({
    id: enrollResult.data.id,
    qrCode: qrCode,
    secret: enrollResult.data.secret,
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
