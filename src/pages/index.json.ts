import type { APIRoute } from 'astro'
import { PackageStore } from '../store.js'

const store = new PackageStore(process.env['STORAGE_DIR'] ?? './storage')

export const GET: APIRoute = () => {
  const index = store.readIndex()
  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json' }
  })
}
