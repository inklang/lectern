import type { APIRoute } from 'astro'
import { getPackageAdvisories, upsertAdvisory, getPackageOwner } from '../../../../lib/db.js'
import { isOrgAdmin } from '../../../../lib/orgs.js'
import { resolveAuth } from '../../../../lib/tokens.js'
import { supabase } from '../../../../lib/supabase.js'

// GET /api/packages/[name]/advisories
// Returns cached advisories for this package (public)
export const GET: APIRoute = async ({ params }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  try {
    const advisories = await getPackageAdvisories(name)
    return new Response(
      JSON.stringify({ package_name: name, advisories }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }
}

// PUT /api/packages/[name]/advisories
// Auth: Bearer token with org admin permission (for org-owned packages)
// Body: advisory fields
export const PUT: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  // Auth
  const userId = await resolveAuth(request.headers.get('authorization'))
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), { status: 401 })
  }

  // Get package ownership to check org admin status
  const ownerId = await getPackageOwner(name)
  if (!ownerId) {
    return new Response(JSON.stringify({ error: 'Package not found' }), { status: 404 })
  }

  // For org-owned packages, check if user is org admin
  const { data: pkg } = await supabase
    .from('packages').select('owner_id, owner_type').eq('name', name).single()

  if (pkg?.owner_type === 'org') {
    if (!(await isOrgAdmin(pkg.owner_id, userId))) {
      return new Response(JSON.stringify({ error: 'Not an org admin' }), { status: 403 })
    }
  } else {
    // User-owned packages: only owner can add advisories
    if (ownerId !== userId) {
      return new Response(JSON.stringify({ error: 'Not the package owner' }), { status: 403 })
    }
  }

  // Parse body
  let body: {
    advisory_id: string
    cve?: string
    severity: string
    title: string
    affected_versions: string
    fixed_version?: string
    advisory_url: string
    source?: string
    published_at?: string
  }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  // Validate required fields
  if (!body.advisory_id || !body.severity || !body.title || !body.affected_versions || !body.advisory_url) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 })
  }

  if (!['low', 'medium', 'high', 'critical'].includes(body.severity)) {
    return new Response(JSON.stringify({ error: 'Invalid severity' }), { status: 400 })
  }

  try {
    await upsertAdvisory({
      package_name: name,
      advisory_id: body.advisory_id,
      cve: body.cve ?? null,
      severity: body.severity as 'low' | 'medium' | 'high' | 'critical',
      title: body.title,
      affected_versions: body.affected_versions,
      fixed_version: body.fixed_version ?? null,
      advisory_url: body.advisory_url,
      source: body.source ?? 'manual',
      published_at: body.published_at ?? null,
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  return new Response(null, { status: 204 })
}
