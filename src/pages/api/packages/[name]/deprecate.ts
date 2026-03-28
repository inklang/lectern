import type { APIRoute } from 'astro'
import { resolveAuth } from '../../../../lib/tokens.js'
import { canUserDeprecate } from '../../../../lib/authz.js'
import { setPackageDeprecation } from '../../../../lib/db.js'

// PUT /api/packages/[name]/deprecate
// Body: { deprecated: boolean, message?: string }
// Auth: Bearer token (package owner only)
export const PUT: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  // Auth
  const userId = await resolveAuth(request.headers.get('authorization'))
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header. Run `quill login` first.' }), { status: 401 })
  }

  // Permission check
  if (!(await canUserDeprecate(userId, name))) {
    return new Response(JSON.stringify({ error: `You do not have permission to deprecate ${name}` }), { status: 403 })
  }

  // Parse body
  let body: { deprecated?: boolean; message?: string }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  if (typeof body.deprecated !== 'boolean') {
    return new Response(JSON.stringify({ error: '`deprecated` field must be a boolean' }), { status: 400 })
  }

  try {
    await setPackageDeprecation(name, body.deprecated, body.message ?? null, userId)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  return new Response(null, { status: 204 })
}
