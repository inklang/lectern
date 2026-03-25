import type { APIRoute } from 'astro'
import { getStarCount, getPackageStarrers, getPackageVersions } from '../../../../lib/db.js'

// GET /api/packages/:name/stars - Get star count and list of starrers
// Public endpoint
export const GET: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  // Verify package exists
  const versions = await getPackageVersions(name)
  if (!versions.length) {
    return new Response(JSON.stringify({ error: 'Package not found' }), { status: 404 })
  }

  // Parse query params
  const url = new URL(request.url)
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20')))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0'))

  let starCount: number
  let starrers: { userId: string; starredAt: string }[]

  try {
    starCount = await getStarCount(name)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  try {
    starrers = await getPackageStarrers(name, limit, offset)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  return new Response(JSON.stringify({ starCount, starrers }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
