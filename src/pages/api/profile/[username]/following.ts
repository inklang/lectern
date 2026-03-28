import type { APIRoute } from 'astro'
import { getUserFollowing } from '~/lib/follows.js'
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

  const following = await getUserFollowing(targetUser.id, limit, offset)

  // Get following user info
  const followingIds = following.map(f => f.following_id)
  let followingUsers: Array<{ id: string; user_name: string }> = []

  if (followingIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, user_name')
      .in('id', followingIds)
    followingUsers = users ?? []
  }

  const result = following.map(f => {
    const u = followingUsers.find(u => u.id === f.following_id)
    return {
      userId: f.following_id,
      userName: u?.user_name ?? 'unknown',
    }
  })

  return new Response(JSON.stringify({ following: result, total: result.length }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
