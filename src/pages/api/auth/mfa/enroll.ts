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

  // Check for existing verified MFA
  const { data: factorsData } = await supabase.auth.mfa.listFactors()
  const existingVerified = factorsData?.factors?.find((f: any) => f.factor_type === 'totp' && f.status === 'verified')

  if (existingVerified) {
    return new Response(JSON.stringify({ error: 'MFA is already enabled on your account' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Try to enroll
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
  })

  if (error) {
    if (error.message.includes('already exists')) {
      // There's an unverified factor blocking enrollment - delete it and retry
      const existingUnverified = factorsData?.factors?.find((f: any) => f.factor_type === 'totp' && f.status === 'unverified')
      if (existingUnverified) {
        await supabase.auth.mfa.unenroll({ factorId: existingUnverified.id })
      }

      // Retry enrollment after cleanup
      const retryResult = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (retryResult.error || !retryResult.data) {
        return new Response(JSON.stringify({ error: retryResult.error?.message ?? 'Failed to enroll MFA after cleanup' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({
        id: retryResult.data.id,
        qrCode: retryResult.data.qrCode,
        secret: retryResult.data.secret,
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: error.message }), {
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
    qrCode: data.qrCode,
    secret: data.secret,
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
