import type { APIRoute } from 'astro'
import { getTrendingPackages } from '../../../lib/db.js'

export const GET: APIRoute = async ({ url }) => {
  const windowDays = Math.max(1, parseInt(url.searchParams.get('window') ?? '7'))
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '5')))

  let trending
  try {
    trending = await getTrendingPackages(windowDays, limit)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  return new Response(JSON.stringify(trending), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
