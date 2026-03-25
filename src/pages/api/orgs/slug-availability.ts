import type { APIRoute } from 'astro'
import { slugAvailable } from '../../../lib/orgs.js'

export const GET: APIRoute = async ({ url }) => {
  const slug = url.searchParams.get('slug')
  if (!slug || !/^[a-z0-9-]+$/.test(slug) || slug.length < 3 || slug.length > 32) {
    return new Response(JSON.stringify({ error: 'Invalid slug' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const available = await slugAvailable(slug)

  const suggestions: string[] = []
  if (!available) {
    // Suggest similar slugs
    const base = slug.replace(/-\d+$/, '')
    for (let i = 1; i <= 3; i++) {
      const candidate = `${base}-${i}`
      if (await slugAvailable(candidate)) {
        suggestions.push(candidate)
      }
    }
  }

  return new Response(JSON.stringify({ available, suggestions }), { headers: { 'Content-Type': 'application/json' } })
}
