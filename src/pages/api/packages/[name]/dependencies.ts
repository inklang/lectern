import type { APIRoute } from 'astro'
import { getVersionDependencies, getPackageVersions } from '../../../../lib/db.js'

// GET /api/packages/[name]/dependencies?version=1.0.0
// Returns the dependency tree for a specific version (defaults to latest)
export const GET: APIRoute = async ({ params, url }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  const version = url.searchParams.get('version')

  try {
    if (version) {
      // Get specific version's dependencies
      const deps = await getVersionDependencies(name, version)
      return new Response(
        JSON.stringify({ name, version, dependencies: deps }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    } else {
      // No version specified: return latest version's dependencies
      const versions = await getPackageVersions(name)
      if (!versions.length) {
        return new Response(JSON.stringify({ error: 'Package not found' }), { status: 404 })
      }
      const latest = versions[0]
      return new Response(
        JSON.stringify({ name, version: latest.version, dependencies: latest.dependencies }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }
}
