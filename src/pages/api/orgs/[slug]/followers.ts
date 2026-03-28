import type { APIRoute } from 'astro'
import { getOrgFollowers } from '~/lib/follows.js'
import { getOrgBySlug } from '~/lib/orgs.js'
import { supabase } from '~/lib/supabase.js'

export const GET: APIRoute = async ({ params, url }) => {
  const { slug } = params
  if (!slug) {
    return new Response(JSON.stringify({ error: 'Slug required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const org = await getOrgBySlug(slug)
  if (!org) {
    return new Response(JSON.stringify({ error: 'Org not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  }

  const limit = parseInt(url.searchParams.get('limit') ?? '20', 10)
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)

  const followers = await getOrgFollowers(org.id, limit, offset)

  const followerIds = followers.map(f => f.follower_id)
  let followerUsers: Array<{ id: string; user_name: string }> = []

  if (followerIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, user_name')
      .in('id', followerIds)
    followerUsers = users ?? []
  }

  const result = followers.map(f => {
    const u = followerUsers.find(u => u.id === f.follower_id)
    return {
      userId: f.follower_id,
      userName: u?.user_name ?? 'unknown',
    }
  })

  return new Response(JSON.stringify({ followers: result, total: result.length }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
