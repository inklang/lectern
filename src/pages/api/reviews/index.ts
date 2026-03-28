import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../lib/tokens.js'
import { createReview, getPackageReviews, getPackageVersions, getUserReview, getPackageRating } from '../../../lib/db.js'

// POST /api/reviews - Create a review
export const POST: APIRoute = async ({ request }) => {
  // Auth
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Login required to submit reviews.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const userId = await resolveToken(raw)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { packageName: string; rating: number; body?: string }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { packageName, rating, body: reviewBody } = body

  if (!packageName || typeof packageName !== 'string') {
    return new Response(JSON.stringify({ error: 'packageName is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
    return new Response(JSON.stringify({ error: 'rating must be a number between 1 and 5.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Verify package exists
  const versions = await getPackageVersions(packageName)
  if (!versions.length) {
    return new Response(JSON.stringify({ error: 'Package not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check if user already has a review for this package
  const existingReview = await getUserReview(userId, packageName)
  if (existingReview) {
    return new Response(JSON.stringify({ error: 'You have already reviewed this package. Use PUT to update.' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const review = await createReview(userId, packageName, rating, reviewBody)
    return new Response(JSON.stringify(review), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Database error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// GET /api/reviews?package=X&limit=20&offset=0 - List reviews for a package
export const GET: APIRoute = async ({ url }) => {
  const packageName = url.searchParams.get('package')
  const limit = parseInt(url.searchParams.get('limit') ?? '20', 10)
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)

  if (!packageName) {
    return new Response(JSON.stringify({ error: 'package query param is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const [reviews, rating] = await Promise.all([
      getPackageReviews(packageName, limit, offset),
      getPackageRating(packageName),
    ])

    return new Response(JSON.stringify({ reviews, rating }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Database error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
