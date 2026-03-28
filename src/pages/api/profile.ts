import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { updateUserProfile } from '~/lib/users.js'

export const PATCH: APIRoute = async ({ request }) => {
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

  const body = await request.json() as {
    bio?: string
    website?: string
    twitter?: string
    github?: string
    avatar_url?: string
  }

  if (body.website && !body.website.match(/^https?:\/\//)) {
    return new Response(JSON.stringify({ error: 'Website must start with http:// or https://' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const updates: {
    bio?: string
    website?: string
    twitter?: string
    github?: string
    avatar_url?: string
  } = {}

  if (body.bio !== undefined) {
    updates.bio = body.bio.trim() || undefined
  }
  if (body.website !== undefined) {
    updates.website = body.website.trim() || undefined
  }
  if (body.twitter !== undefined) {
    updates.twitter = body.twitter.replace(/^@/, '').trim() || undefined
  }
  if (body.github !== undefined) {
    updates.github = body.github.replace(/^@/, '').trim() || undefined
  }
  if (body.avatar_url !== undefined) {
    updates.avatar_url = body.avatar_url.trim() || undefined
  }

  try {
    const updatedProfile = await updateUserProfile(user.id, updates)
    return new Response(JSON.stringify(updatedProfile), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to update profile' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
