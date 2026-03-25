import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
import { canUserPublish } from '../../../../lib/authz.js'
import { addPackageTag } from '../../../../lib/db.js'

export const POST: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

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
    return new Response(JSON.stringify({ error: 'You do not have permission to tag this package' }), { status: 403 })
  }

  let body: { tags?: string | string[] }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  const rawTags = Array.isArray(body.tags) ? body.tags : typeof body.tags === 'string' ? [body.tags] : []
  if (!rawTags.length) {
    return new Response(JSON.stringify({ error: 'tags field is required (string or array)' }), { status: 400 })
  }

  const tags = rawTags.map(t => String(t).trim().toLowerCase()).filter(t => t.length > 0 && t.length <= 50)
  if (!tags.length) {
    return new Response(JSON.stringify({ error: 'tags must be 1-50 character non-empty strings' }), { status: 400 })
  }

  const errors: string[] = []
  for (const tag of tags) {
    try {
      await addPackageTag(name, tag)
    } catch {
      errors.push(tag)
    }
  }

  if (errors.length === tags.length) {
    return new Response(JSON.stringify({ error: 'Failed to add all tags' }), { status: 500 })
  }

  return new Response(JSON.stringify({ added: tags.filter(t => !errors.includes(t)), failed: errors }), { status: 200 })
}
