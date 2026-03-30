import type { APIRoute } from 'astro'
import { getAllAdvisories } from '../../lib/db.js'
import { supabase } from '../../lib/supabase.js'
import { verifyApiToken } from '../../lib/api-tokens.js'

// GET /api/advisories
// Returns all advisories (paginated)
// Query params: limit (default 50), offset (default 0)
export const GET: APIRoute = async ({ url }) => {
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  try {
    const { advisories, total } = await getAllAdvisories(limit, offset)
    return new Response(
      JSON.stringify({
        advisories,
        pagination: {
          total,
          limit,
          offset,
          has_more: offset + advisories.length < total,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }
}

export const POST: APIRoute = async ({ request }) => {
  // Require admin token
  const authHeader = request.headers.get('authorization')
  const tokenData = await verifyApiToken(authHeader?.replace('Bearer ', '') ?? '').catch(() => null)
  if (!tokenData || tokenData.tokenType !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin token required' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await request.json() as Record<string, unknown>
  const required = ['package_name', 'advisory_id', 'severity', 'affected_versions', 'title', 'advisory_url']
  for (const field of required) {
    if (!body[field]) {
      return new Response(JSON.stringify({ error: `Missing required field: ${field}` }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  const { data, error } = await supabase
    .from('package_advisories')
    .insert({
      package_name: body.package_name,
      advisory_id: body.advisory_id,
      cve: body.cve ?? null,
      severity: body.severity,
      affected_versions: body.affected_versions,
      fixed_version: body.fixed_version ?? null,
      title: body.title,
      advisory_url: body.advisory_url,
      source: 'manual',
      published_at: body.published_at ?? null,
    })
    .select()
    .single()

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Async re-scan: find all package_versions that depend on this package, update vulnerability cache
  triggerRescan(data.id, String(body.package_name)).catch(e =>
    console.error('Advisory re-scan failed:', e)
  )

  return new Response(JSON.stringify(data), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}

async function triggerRescan(advisoryId: string, packageName: string) {
  const { scanDependencies } = await import('../../lib/security.js')

  // Find all versions that declare a dependency on the affected package
  const { data: versions } = await supabase
    .from('package_versions')
    .select('package_slug, version, dependencies')
    .not('dependencies', 'is', null)

  const affected = (versions ?? []).filter(
    v => v.dependencies && Object.prototype.hasOwnProperty.call(v.dependencies, packageName)
  )

  for (const v of affected) {
    try {
      const hits = await scanDependencies(v.dependencies ?? {})
      if (hits.length === 0) continue

      const rows = hits.map(h => ({
        package_name: v.package_slug,
        version: v.version,
        advisory_id: advisoryId,
        severity: h.advisory.severity,
        dep_name: h.dep,
        dep_range: h.depRange,
      }))

      await supabase
        .from('package_vulnerability_cache')
        .upsert(rows, { onConflict: 'package_name,version,advisory_id' })
    } catch (e) {
      console.error(`Re-scan failed for ${v.package_slug}@${v.version}:`, e)
    }
  }
}
