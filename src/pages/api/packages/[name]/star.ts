import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
import { starPackage, unstarPackage, hasStarred, getStarCount, getPackageVersions } from '../../../../lib/db.js'

// PUT /api/packages/:name/star - Star a package
// Auth: Bearer token
export const PUT: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  // Verify package exists
  const versions = await getPackageVersions(name)
  if (!versions.length) {
    return new Response(JSON.stringify({ error: 'Package not found' }), { status: 404 })
  }

  // Auth
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Login to star packages.' }), { status: 401 })
  }

  const userId = await resolveToken(raw)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token.' }), { status: 401 })
  }

  try {
    await starPackage(userId, name)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  // Get updated star count
  let starCount: number
  try {
    starCount = await getStarCount(name)
  } catch {
    starCount = 0
  }

  return new Response(JSON.stringify({ starred: true, starCount }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

// DELETE /api/packages/:name/star - Unstar a package
// Auth: Bearer token
export const DELETE: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  // Verify package exists
  const versions = await getPackageVersions(name)
  if (!versions.length) {
    return new Response(JSON.stringify({ error: 'Package not found' }), { status: 404 })
  }

  // Auth
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Login to star packages.' }), { status: 401 })
  }

  const userId = await resolveToken(raw)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token.' }), { status: 401 })
  }

  // Check if user has starred
  const starred = await hasStarred(userId, name)
  if (!starred) {
    return new Response(JSON.stringify({ error: 'Not starred' }), { status: 404 })
  }

  try {
    await unstarPackage(userId, name)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  // Get updated star count
  let starCount: number
  try {
    starCount = await getStarCount(name)
  } catch {
    starCount = 0
  }

  return new Response(JSON.stringify({ starred: false, starCount }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

// GET /api/packages/:name/star - Check if authenticated user has starred
// Auth: Bearer token (optional - returns { starred: false } if not authenticated)
export const GET: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) {
    return new Response(JSON.stringify({ starred: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const userId = await resolveToken(raw)
  if (!userId) {
    return new Response(JSON.stringify({ starred: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const starred = await hasStarred(userId, name)

  return new Response(JSON.stringify({ starred }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
