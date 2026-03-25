import type { APIRoute } from 'astro'
import { getAllAdvisories } from '../../lib/db.js'

// GET /api/advisories
// Returns all advisories (paginated)
// Query params: limit (default 50), offset (default 0)
export const GET: APIRoute = async ({ url }) => {
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  try {
    const { advisories, total } = await getAllAdvisories(limit, offset)
    return new Response(
      JSON.stringify({
        advisories,
        pagination: {
          total,
          limit,
          offset,
          has_more: offset + advisories.length < total,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }
}
