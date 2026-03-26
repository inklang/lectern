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
  console.error('listFactors result:', JSON.stringify(factorsRes))

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
      await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
  }

  // Now try to enroll
  const enrollResult = await supabase.auth.mfa.enroll({
    factorType: 'totp',
  })

  console.error('enrollResult:', JSON.stringify(enrollResult))

  if (enrollResult.error) {
    // If already exists error, it means there's a factor we couldn't clean up
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

  return new Response(JSON.stringify({
    id: enrollResult.data.id,
    qrCode: enrollResult.data.qrCode,
    secret: enrollResult.data.secret,
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
