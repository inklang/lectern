import type { APIRoute } from 'astro'
import { extractBearer, revokeToken } from '../../../lib/tokens.js'

export const DELETE: APIRoute = async ({ request }) => {
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), { status: 401 })
  }

  const ok = await revokeToken(raw)
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Token not found' }), { status: 401 })
  }

  return new Response(null, { status: 204 })
}
