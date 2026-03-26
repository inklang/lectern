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

    // If error says factor already exists, try to clean up and retry
    const errMsg = error.message || ''
    if (errMsg.toLowerCase().includes('already exists')) {
      const factorsRes = await supabase.auth.mfa.listFactors()
      console.log('listFactors:', factorsRes)

      if (!factorsRes.error && factorsRes.data?.factors) {
        const unverifiedTotp = factorsRes.data.factors.find(
          (f: any) => f.factor_type === 'totp' && f.status === 'unverified'
        )
        console.log('unverifiedTotp:', unverifiedTotp)

        if (unverifiedTotp) {
          await supabase.auth.mfa.unenroll({ factorId: unverifiedTotp.id })
          console.log('unenrolled old factor')

          const retryRes = await supabase.auth.mfa.enroll({ factorType: 'totp' })
          console.log('retry result:', retryRes)

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
