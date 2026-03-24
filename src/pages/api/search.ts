import type { APIRoute } from 'astro'
import { hybridSearch } from '../../lib/search.js'

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim()

  if (!q) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const results = await hybridSearch(q)
  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' }
  })
}
