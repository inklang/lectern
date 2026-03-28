import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { followUser, unfollowUser, followOrg, unfollowOrg } from '~/lib/follows.js'
import { getUserByUsername, getOrgBySlug } from '~/lib/orgs.js'

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
  const { type, targetId } = body as { type: 'user' | 'org'; targetId: string }

  if (!type || !targetId) {
    return new Response(JSON.stringify({ error: 'type and targetId are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  if (type === 'user') {
    const targetUser = await getUserByUsername(targetId)
    if (!targetUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }
    try {
      await followUser(user.id, targetUser.id)
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to follow user' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
  } else if (type === 'org') {
    const targetOrg = await getOrgBySlug(targetId)
    if (!targetOrg) {
      return new Response(JSON.stringify({ error: 'Org not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }
    try {
      await followOrg(user.id, targetOrg.id)
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to follow org' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
  } else {
    return new Response(JSON.stringify({ error: 'Invalid type' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  return new Response(JSON.stringify({ following: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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
  const { type, targetId } = body as { type: 'user' | 'org'; targetId: string }

  if (!type || !targetId) {
    return new Response(JSON.stringify({ error: 'type and targetId are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  if (type === 'user') {
    const targetUser = await getUserByUsername(targetId)
    if (!targetUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }
    try {
      await unfollowUser(user.id, targetUser.id)
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to unfollow user' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
  } else if (type === 'org') {
    const targetOrg = await getOrgBySlug(targetId)
    if (!targetOrg) {
      return new Response(JSON.stringify({ error: 'Org not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }
    try {
      await unfollowOrg(user.id, targetOrg.id)
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to unfollow org' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
  } else {
    return new Response(JSON.stringify({ error: 'Invalid type' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  return new Response(JSON.stringify({ following: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
