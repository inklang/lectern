import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../lib/tokens.js'
import { supabase } from '../../lib/supabase.js'
import { updateReview, deleteReview } from '../../lib/db.js'

// Helper to get review by ID
async function getReviewById(reviewId: string) {
  const { data, error } = await supabase
    .from('package_reviews')
    .select('*')
    .eq('id', reviewId)
    .single()
  if (error) return null
  return data
}

// PUT /api/reviews/[reviewId] - Update own review
export const PUT: APIRoute = async ({ params, request }) => {
  const { reviewId } = params
  if (!reviewId) {
    return new Response(JSON.stringify({ error: 'reviewId is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Auth
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Login required to update reviews.' }), {
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

  // Get the review
  const review = await getReviewById(reviewId)
  if (!review) {
    return new Response(JSON.stringify({ error: 'Review not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check ownership
  if (review.user_id !== userId) {
    return new Response(JSON.stringify({ error: 'You can only update your own reviews.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { rating: number; body?: string }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { rating, body: reviewBody } = body

  if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
    return new Response(JSON.stringify({ error: 'rating must be a number between 1 and 5.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const updated = await updateReview(userId, review.package_name, rating, reviewBody)
    return new Response(JSON.stringify(updated), {
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

// DELETE /api/reviews/[reviewId] - Delete own review
export const DELETE: APIRoute = async ({ params, request }) => {
  const { reviewId } = params
  if (!reviewId) {
    return new Response(JSON.stringify({ error: 'reviewId is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Auth
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Login required to delete reviews.' }), {
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

  // Get the review
  const review = await getReviewById(reviewId)
  if (!review) {
    return new Response(JSON.stringify({ error: 'Review not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check ownership
  if (review.user_id !== userId) {
    return new Response(JSON.stringify({ error: 'You can only delete your own reviews.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await deleteReview(userId, review.package_name)
    return new Response(JSON.stringify({ success: true }), {
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
