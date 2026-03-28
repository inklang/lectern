import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { pinPackage, unpinPackage, getUserPinnedPackages } from '~/lib/users.js'

const MAX_PINS = 6

export const POST: APIRoute = async ({ request }) => {
  const supabase = createServerClient(
    import.meta.env.SUPABASE_URL ?? '',
    import.meta.env.SUPABASE_PUBLISHABLE_KEY ?? '',
    {
      cookies: {
        getAll() { return parseCookieHeader(request.headers.get('Cookie') ?? '') },
        setAll() {},
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }

  const body = await request.json()
  const { packageName } = body as { packageName: string }

  if (!packageName) {
    return new Response(JSON.stringify({ error: 'packageName required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const existingPins = await getUserPinnedPackages(user.id)
  if (existingPins.length >= MAX_PINS) {
    return new Response(JSON.stringify({ error: 'Maximum 6 pinned packages allowed' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const alreadyPinned = existingPins.some(p => p.packageName === packageName)

  try {
    if (!alreadyPinned) {
      const position = existingPins.length
      await pinPackage(user.id, packageName, position)
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to pin package' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  return new Response(JSON.stringify({ pinned: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

export const DELETE: APIRoute = async ({ request }) => {
  const supabase = createServerClient(
    import.meta.env.SUPABASE_URL ?? '',
    import.meta.env.SUPABASE_PUBLISHABLE_KEY ?? '',
    {
      cookies: {
        getAll() { return parseCookieHeader(request.headers.get('Cookie') ?? '') },
        setAll() {},
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }

  const body = await request.json()
  const { packageName } = body as { packageName: string }

  if (!packageName) {
    return new Response(JSON.stringify({ error: 'packageName required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    await unpinPackage(user.id, packageName)
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to unpin package' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  return new Response(JSON.stringify({ pinned: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
