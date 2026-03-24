import type { APIRoute } from 'astro'
import { listAllPackages } from '../lib/db.js'

export const GET: APIRoute = async () => {
  const packages = await listAllPackages()
  return new Response(JSON.stringify({ packages }), {
    headers: { 'Content-Type': 'application/json' }
  })
}
