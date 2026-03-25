import type { APIRoute } from 'astro'
import { getPackageHealth } from '../../../../lib/db.js'

export const GET: APIRoute = async ({ params }) => {
  const { name } = params
  if (!name) {
    return new Response(JSON.stringify({ error: 'Package name required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const health = await getPackageHealth(name)
    if (!health) {
      return new Response(JSON.stringify({ error: 'Package not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(health), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    console.error('Error fetching package health:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
