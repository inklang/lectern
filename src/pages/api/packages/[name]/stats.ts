import type { APIRoute } from 'astro'
import { getPackageStats, getPackageVersions } from '../../../../lib/db.js'

export const GET: APIRoute = async ({ params }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  // Verify package exists
  const versions = await getPackageVersions(name)
  if (!versions.length) {
    return new Response(JSON.stringify({ error: 'Package not found' }), { status: 404 })
  }

  let stats
  try {
    stats = await getPackageStats(name)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  return new Response(JSON.stringify(stats), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
