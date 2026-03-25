import type { APIRoute } from 'astro'
import { getUserStars } from '../../../../lib/db.js'

// GET /api/users/:userId/stars - List packages a user has starred
// Public endpoint
export const GET: APIRoute = async ({ params, request }) => {
  const { userId } = params
  if (!userId) return new Response('Bad request', { status: 400 })

  // Parse query params
  const url = new URL(request.url)
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20')))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0'))

  let stars: { packageName: string; starredAt: string }[]

  try {
    stars = await getUserStars(userId, limit, offset)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  return new Response(JSON.stringify({ stars, total: stars.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
