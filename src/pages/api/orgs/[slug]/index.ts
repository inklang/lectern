import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
import { getOrgBySlug, isOrgAdmin } from '../../../../lib/orgs.js'
import { logAuditEvent } from '../../../../lib/audit.js'

export const GET: APIRoute = async ({ params }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  return new Response(JSON.stringify(org), { headers: { 'Content-Type': 'application/json' } })
}

export const PUT: APIRoute = async ({ params, request }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const body = await request.json()
  const { name, description } = body

  const { supabase } = await import('../../../../lib/supabase.js')
  const { data, error } = await supabase
    .from('orgs')
    .update({ name: name ?? org.name, description: description ?? org.description })
    .eq('id', org.id)
    .select()
    .single()

  if (error) return new Response(JSON.stringify({ error: 'failed to update org' }), { status: 500, headers: { 'Content-Type': 'application/json' } })

  // Log audit event
  logAuditEvent({
    orgId: org.id,
    userId,
    action: 'org.update',
    resourceType: 'org',
    resourceId: org.id,
    details: { name, description },
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  }).catch(() => {})

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
}
