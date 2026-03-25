import type { APIRoute } from 'astro'
import { listTags } from '../../../lib/db.js'

export const GET: APIRoute = async () => {
  let tags
  try {
    tags = await listTags()
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  return new Response(JSON.stringify(tags), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
