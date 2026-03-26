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

  console.error('=== MFA ENROLL DEBUG ===')
  console.error('error:', error ? JSON.stringify(error) : 'none')
  console.error('data:', data ? JSON.stringify(data) : 'none')
  console.error('=======================')

  if (error) {
    const errMsg = error.message || ''

    console.error('Error message:', errMsg)
    console.error('Contains already exists:', errMsg.toLowerCase().includes('already exists'))

    if (errMsg.toLowerCase().includes('already exists')) {
      console.error('Attempting to list factors...')

      const factorsRes = await supabase.auth.mfa.listFactors()

      console.error('factorsRes.error:', factorsRes.error ? JSON.stringify(factorsRes.error) : 'none')
      console.error('factorsRes.data:', factorsRes.data ? JSON.stringify(factorsRes.data) : 'none')
      console.error('factorsRes.data?.factors:', factorsRes.data?.factors ? JSON.stringify(factorsRes.data.factors) : 'none')

      if (factorsRes.error) {
        console.error('listFactors returned error, returning that')
        return new Response(JSON.stringify({ error: `listFactors failed: ${factorsRes.error.message}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (!factorsRes.data?.factors || factorsRes.data.factors.length === 0) {
        console.error('No factors returned at all')
        return new Response(JSON.stringify({ error: 'Inconsistent state: factor exists but list is empty. Try signing out and back in.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const totpFactors = factorsRes.data.factors.filter((f: any) => f.factor_type === 'totp')
      console.error('TOTP factors:', JSON.stringify(totpFactors))

      if (totpFactors.length === 0) {
        console.error('No TOTP factors but got already exists error - weird')
        return new Response(JSON.stringify({ error: 'No TOTP factors found but got already exists' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      for (const f of totpFactors) {
        console.error(`Deleting factor ${f.id} status=${f.status}`)
        const unenrollRes = await supabase.auth.mfa.unenroll({ factorId: f.id })
        console.error(`Unenroll result:`, JSON.stringify(unenrollRes))
      }

      console.error('Retrying enroll after cleanup...')
      const retryRes = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      console.error('retryRes:', JSON.stringify(retryRes))

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
