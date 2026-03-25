import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../../../lib/tokens.js'
import { canUserPublish } from '../../../../../../lib/authz.js'
import { removePackageTag } from '../../../../../../lib/db.js'

export const DELETE: APIRoute = async ({ params, request }) => {
  const { name, tag } = params
  if (!name || !tag) return new Response('Bad request', { status: 400 })

  // Auth
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 })
  }
  const userId = await resolveToken(raw)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401 })
  }

  // Owner check
  if (!(await canUserPublish(userId, name))) {
    return new Response(JSON.stringify({ error: 'You do not have permission to modify tags on this package' }), { status: 403 })
  }

  try {
    await removePackageTag(name, decodeURIComponent(tag))
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  return new Response(null, { status: 204 })
}
