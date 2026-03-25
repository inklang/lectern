import { supabase } from './supabase.js'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
  limit: number
}

/**
 * Check and update rate limit using a sliding window counter.
 *
 * @param userId    - User ID (null for anonymous)
 * @param tokenId   - Token ID if token-based auth (null for session-based)
 * @param endpoint  - Endpoint pattern (e.g. 'PUT /api/packages/*')
 * @param limit     - Max requests per window
 * @param windowSeconds - Window duration in seconds
 */
export async function checkRateLimit(
  userId: string | null,
  tokenId: string | null,
  endpoint: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - windowSeconds * 1000)

  // Try to find existing record in current window
  const { data: existing } = await supabase
    .from('rate_limits')
    .select('id, request_count')
    .eq('endpoint_pattern', endpoint)
    .gte('window_start', windowStart.toISOString())
    .eq('user_id', userId ?? null)
    .eq('token_id', tokenId ?? null)
    .single()

  if (existing) {
    // Increment
    const newCount = existing.request_count + 1
    const allowed = newCount <= limit
    const resetAt = new Date(now.getTime() + windowSeconds * 1000)

    await supabase
      .from('rate_limits')
      .update({ request_count: newCount })
      .eq('id', existing.id)

    return {
      allowed,
      remaining: Math.max(0, limit - newCount),
      resetAt,
      limit,
    }
  } else {
    // Insert new record
    const resetAt = new Date(now.getTime() + windowSeconds * 1000)

    await supabase
      .from('rate_limits')
      .insert({
        user_id: userId ?? null,
        token_id: tokenId ?? null,
        endpoint_pattern: endpoint,
        window_start: now.toISOString(),
        request_count: 1,
      })

    return {
      allowed: true,
      remaining: limit - 1,
      resetAt,
      limit,
    }
  }
}

/**
 * Build rate limit headers for HTTP responses.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': result.resetAt.toISOString(),
  }
}

/**
 * Build 429 Too Many Requests response with Retry-After header.
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  const retryAfter = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)
  return new Response(JSON.stringify({ error: 'Too many requests. Please retry later.' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfter),
      ...rateLimitHeaders(result),
    },
  })
}
