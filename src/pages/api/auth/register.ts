import type { APIRoute } from 'astro'
import { PackageStore } from '../../../store.js'

const store = new PackageStore(process.env['STORAGE_DIR'] ?? './storage')

export const POST: APIRoute = async ({ request }) => {
  let body: { publicKey?: string; fingerprint?: string }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })
  }

  const { publicKey, fingerprint } = body
  if (!publicKey || !fingerprint) {
    return new Response(JSON.stringify({ error: 'publicKey and fingerprint required' }), { status: 400 })
  }

  // Validate the fingerprint matches the public key
  const { createHash } = await import('crypto')
  const der = Buffer.from(publicKey, 'base64')
  const expectedFp = createHash('sha256').update(der).digest('hex').slice(0, 16)
  if (expectedFp !== fingerprint) {
    return new Response(JSON.stringify({ error: 'Fingerprint does not match public key' }), { status: 400 })
  }

  if (store.hasKey(fingerprint)) {
    return new Response(JSON.stringify({ fingerprint }), { status: 200 })
  }

  store.registerKey(fingerprint, publicKey)
  return new Response(JSON.stringify({ fingerprint }), { status: 201 })
}
