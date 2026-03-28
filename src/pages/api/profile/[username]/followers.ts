import type { APIRoute } from 'astro'
import { getUserFollowers } from '~/lib/follows.js'
import { getUserByUsername } from '~/lib/orgs.js'
import { supabase } from '~/lib/supabase.js'

export const GET: APIRoute = async ({ params, url }) => {
  const { username } = params
  if (!username) {
    return new Response(JSON.stringify({ error: 'Username required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const targetUser = await getUserByUsername(username)
  if (!targetUser) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  }

  const limit = parseInt(url.searchParams.get('limit') ?? '20', 10)
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)

  const followers = await getUserFollowers(targetUser.id, limit, offset)

  // Get follower user info
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
