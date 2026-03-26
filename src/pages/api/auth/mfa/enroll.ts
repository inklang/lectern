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
    const errMsg = error.message || ''

    if (errMsg.toLowerCase().includes('already exists')) {
      console.log('Factor already exists, listing factors...')

      const factorsRes = await supabase.auth.mfa.listFactors()
      console.log('factorsRes.error:', factorsRes.error)
      console.log('factorsRes.data:', JSON.stringify(factorsRes.data))

      if (factorsRes.error) {
        console.error('listFactors failed:', factorsRes.error)
        return new Response(JSON.stringify({ error: `listFactors failed: ${factorsRes.error.message}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (!factorsRes.data?.factors || factorsRes.data.factors.length === 0) {
        console.log('No factors returned, but enroll said one exists - this is weird')
        return new Response(JSON.stringify({ error: 'Inconsistent state: factor exists but list is empty. Try signing out and back in.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const totpFactors = factorsRes.data.factors.filter((f: any) => f.factor_type === 'totp')
      console.log('TOTP factors count:', totpFactors.length)
      console.log('TOTP factors:', JSON.stringify(totpFactors))

      if (totpFactors.length === 0) {
        return new Response(JSON.stringify({ error: 'No TOTP factors found but error says one exists' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Delete ALL TOTP factors (regardless of status)
      for (const f of totpFactors) {
        console.log(`Deleting factor ${f.id} status=${f.status}`)
        const unenrollRes = await supabase.auth.mfa.unenroll({ factorId: f.id })
        console.log(`Unenroll result for ${f.id}:`, JSON.stringify(unenrollRes))
      }

      // Retry enrollment
      const retryRes = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      console.log('retryRes:', JSON.stringify(retryRes))

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
