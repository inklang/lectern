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

  // Try to enroll directly - if there's already an unverified factor, Supabase will error
  // and we'll need to handle it
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
  })

  if (error) {
    // If error says factor already exists, try to find and delete the old one
    if (error.message.includes('already exists')) {
      // Get list of factors to find the existing one
      const factorsRes = await supabase.auth.mfa.listFactors()

      if (!factorsRes.error && factorsRes.data?.factors) {
        const unverifiedTotp = factorsRes.data.factors.find(
          (f: any) => f.factor_type === 'totp' && f.status === 'unverified'
        )
        if (unverifiedTotp) {
          // Delete the old factor
          await supabase.auth.mfa.unenroll({ factorId: unverifiedTotp.id })

          // Now retry enrollment
          const retryRes = await supabase.auth.mfa.enroll({ factorType: 'totp' })
          if (retryRes.error || !retryRes.data) {
            return new Response(JSON.stringify({ error: retryRes.error?.message ?? 'Failed to enroll after cleanup' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          // Supabase returns qr_code with underscore
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

  // Supabase returns qr_code with underscore, handle both formats
  return new Response(JSON.stringify({
    id: data.id,
    qrCode: (data as any).qr_code ?? data.qrCode,
    secret: data.secret,
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
