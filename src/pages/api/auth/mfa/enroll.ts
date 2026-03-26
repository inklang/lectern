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
      if (unenrollRes.error) {
        console.error('DEBUG unenroll error:', unenrollRes.error)
      }
    }

    // Re-list factors after cleanup
    const factorsAfterRes = await supabase.auth.mfa.listFactors()
    console.error('DEBUG factors after cleanup:', JSON.stringify(factorsAfterRes))
    const totpFactorsAfter = factorsAfterRes.data?.factors?.filter((f: any) => f.factor_type === 'totp') ?? []
    if (totpFactorsAfter.length > 0) {
      return new Response(JSON.stringify({
        error: 'Could not remove existing MFA factor. Please sign out, sign back in, and try again.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // Now try to enroll
  const enrollResult = await supabase.auth.mfa.enroll({
    factorType: 'totp',
  })

  console.error('DEBUG enroll error:', enrollResult.error)
  console.error('DEBUG enroll data keys:', enrollResult.data ? Object.keys(enrollResult.data) : 'no data')
  console.error('DEBUG enroll data:', JSON.stringify(enrollResult.data))
  console.error('DEBUG enroll id:', enrollResult.data?.id)
  console.error('DEBUG enroll qrCode type:', typeof enrollResult.data?.qrCode)
  console.error('DEBUG enroll qrCode length:', enrollResult.data?.qrCode?.length)
  console.error('DEBUG enroll qr_code:', enrollResult.data?.qr_code)
  console.error('DEBUG enroll secret:', enrollResult.data?.secret)

  if (enrollResult.error) {
    if (enrollResult.error.message?.toLowerCase().includes('already exists')) {
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
