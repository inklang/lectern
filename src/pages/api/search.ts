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

  const typeParam = url.searchParams.get('type') as 'script' | 'library' | null
  const results = await hybridSearch(q, 20, typeParam ?? undefined)
  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' }
  })
}
