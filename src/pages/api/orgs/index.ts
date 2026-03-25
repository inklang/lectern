import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../lib/tokens.js'
import { createOrg, slugAvailable, addOrgMember } from '../../../lib/orgs.js'
import { logAuditEvent } from '../../../lib/audit.js'

export const POST: APIRoute = async ({ request }) => {
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const body = await request.json()
  const { slug, name, description } = body

  if (!slug || !name) {
    return new Response(JSON.stringify({ error: 'slug and name are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Slug must be lowercase alphanumeric + hyphens
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return new Response(JSON.stringify({ error: 'slug must be lowercase alphanumeric with hyphens only' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  if (slug.length < 3 || slug.length > 32) {
    return new Response(JSON.stringify({ error: 'slug must be 3-32 characters' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  if (!(await slugAvailable(slug))) {
    return new Response(JSON.stringify({ error: 'slug is already taken' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const org = await createOrg(slug, name, userId, description)
    await addOrgMember(org.id, userId, 'owner')

    // Log audit event
    logAuditEvent({
      orgId: org.id,
      userId,
      action: 'org.create',
      resourceType: 'org',
      resourceId: org.id,
      details: { slug, name },
      ipAddress: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    }).catch(() => {})

    return new Response(JSON.stringify(org), { status: 201, headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    if (e.code === '23505') return new Response(JSON.stringify({ error: 'slug is already taken' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ error: 'failed to create org' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
