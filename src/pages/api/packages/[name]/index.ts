import type { APIRoute } from 'astro'
import { getPackageVersions } from '../../../../lib/db.js'

export const GET: APIRoute = async ({ params }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  let versions
  try {
    versions = await getPackageVersions(name)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  if (!versions.length) {
    return new Response(JSON.stringify({ error: 'Package not found' }), { status: 404 })
  }

  const latest = versions[0]

  return new Response(
    JSON.stringify({
      name,
      description: latest.description ?? null,
      latest_version: latest.version,
      versions: versions.map((v) => ({
        version: v.version,
        description: v.description ?? null,
        published_at: v.published_at,
        dependencies: v.dependencies ?? {},
        tarball_hash: v.tarball_hash ?? null,
      })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}
