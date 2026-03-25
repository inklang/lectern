import type { APIRoute } from 'astro'
import { getPackageDependents } from '../../../../lib/db.js'

// GET /api/packages/[name]/dependents
// Returns packages/versions that depend on this package
export const GET: APIRoute = async ({ params }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  let dependents
  try {
    dependents = await getPackageDependents(name)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  return new Response(
    JSON.stringify({ dependents }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}
