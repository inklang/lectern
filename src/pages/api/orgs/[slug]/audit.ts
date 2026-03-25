import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getOrgBySlug, isOrgAdmin } from '../../../../lib/orgs.js'
import { queryAuditLog } from '../../../../lib/audit.js'
import type { AuditAction } from '../../../../lib/audit.js'

export const GET: APIRoute = async ({ params, request }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY ?? ''

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() { return parseCookieHeader(request.headers.get('Cookie') ?? '') },
      setAll() {},
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const userId = user.id

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  // Parse query params
  const url = new URL(request.url)
  const action = url.searchParams.get('action') as AuditAction | null
  const resourceType = url.searchParams.get('resourceType') ?? undefined
  const resourceId = url.searchParams.get('resourceId') ?? undefined
  const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from')!) : undefined
  const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : undefined
  const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : 50
  const offset = url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!) : 0

  const result = await queryAuditLog({
    orgId: org.id,
    action: action ?? undefined,
    resourceType,
    resourceId,
    from,
    to,
    limit,
    offset,
  })

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}
