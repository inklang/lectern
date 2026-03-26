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

  // Try to enroll
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
  })

  if (error) {
    console.error('MFA enroll error:', JSON.stringify(error))

    const errMsg = error.message || ''
    if (errMsg.toLowerCase().includes('already exists')) {
      const factorsRes = await supabase.auth.mfa.listFactors()
      console.log('listFactors result:', JSON.stringify(factorsRes))

      if (!factorsRes.error && factorsRes.data?.factors) {
        const totpFactors = factorsRes.data.factors.filter((f: any) => f.factor_type === 'totp')
        console.log('TOTP factors:', JSON.stringify(totpFactors))

        for (const f of totpFactors) {
          if (f.status === 'verified') {
            return new Response(JSON.stringify({ error: 'MFA is already enabled. Please remove it first.' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          }
          // Delete any unverified/pending TOTP factors
          console.log(`Deleting factor ${f.id} with status ${f.status}`)
          await supabase.auth.mfa.unenroll({ factorId: f.id })
        }

        // Retry enrollment after cleanup
        const retryRes = await supabase.auth.mfa.enroll({ factorType: 'totp' })
        console.log('retry result:', JSON.stringify(retryRes))

        if (retryRes.error || !retryRes.data) {
          return new Response(JSON.stringify({ error: retryRes.error?.message ?? 'Failed to enroll after cleanup' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return new Response(JSON.stringify({
          id: retryRes.data.id,
          qrCode: (retryRes.data as any).qr_code ?? retryRes.data.qrCode,
          secret: retryRes.data.secret,
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ error: 'MFA factor already exists. Please remove it first.' }), {
        status: 400,
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

  return new Response(JSON.stringify({
    id: data.id,
    qrCode: (data as any).qr_code ?? data.qrCode,
    secret: data.secret,
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
