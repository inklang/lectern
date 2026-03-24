import type { APIRoute } from 'astro'
import { PackageStore } from '../../../../store.js'
import { extractDependencies } from '../../../../tar.js'
import { createHash, verify } from 'crypto'
import fs from 'fs'

const store = new PackageStore(process.env['STORAGE_DIR'] ?? './storage')

function fingerprint(publicKeyB64: string): string {
  const der = Buffer.from(publicKeyB64, 'base64')
  return createHash('sha256').update(der).digest('hex').slice(0, 16)
}

function verifySignature(data: Buffer, signatureB64: string, publicKeyB64: string): boolean {
  try {
    const keyDer = Buffer.from(publicKeyB64, 'base64')
    const sig = Buffer.from(signatureB64, 'base64')
    return verify(null, data, { key: keyDer, format: 'der', type: 'spki' }, sig)
  } catch {
    return false
  }
}

export const GET: APIRoute = ({ params }) => {
  const { name, version } = params
  if (!name || !version) return new Response('Bad request', { status: 400 })

  const tarball = store.getTarballPath(name, version)
  if (!tarball) return new Response(`${name}@${version} not found`, { status: 404 })

  return new Response(fs.readFileSync(tarball), {
    headers: { 'Content-Type': 'application/gzip' }
  })
}

export const PUT: APIRoute = async ({ params, request }) => {
  const { name, version } = params
  if (!name || !version) return new Response('Bad request', { status: 400 })

  const publicKey = request.headers.get('x-ink-public-key')
  const signature = request.headers.get('x-ink-signature')

  if (!publicKey || !signature) {
    return new Response(JSON.stringify({ error: 'Missing X-Ink-Public-Key or X-Ink-Signature headers. Run `quill login` first.' }), { status: 401 })
  }

  const fp = fingerprint(publicKey)

  // Key must be registered
  if (!store.hasKey(fp)) {
    return new Response(JSON.stringify({ error: `Unknown key ${fp}. Run \`quill login\` to register.` }), { status: 401 })
  }

  // Key stored on server must match what was sent
  const storedKey = store.getPublicKey(fp)
  if (storedKey !== publicKey) {
    return new Response(JSON.stringify({ error: 'Public key mismatch' }), { status: 401 })
  }

  const data = Buffer.from(await request.arrayBuffer())
  if (!data.length) return new Response(JSON.stringify({ error: 'Empty body' }), { status: 400 })

  // Verify signature
  if (!verifySignature(data, signature, publicKey)) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 })
  }

  // Ownership check
  const owner = store.getOwner(name)
  if (owner && owner !== fp) {
    return new Response(JSON.stringify({ error: `Package ${name} is owned by a different key` }), { status: 403 })
  }

  if (store.hasVersion(name, version)) {
    return new Response(JSON.stringify({ error: `${name}@${version} already exists` }), { status: 409 })
  }

  let dependencies: Record<string, string> = {}
  try { dependencies = await extractDependencies(data) } catch {}

  store.saveTarball(name, version, data)

  const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:4321'
  const url = `${baseUrl}/api/packages/${name}/${version}`
  store.registerVersion(name, version, url, dependencies)

  // Set owner on first publish
  if (!owner) store.setOwner(name, fp)

  return new Response(JSON.stringify({ name, version, url }), { status: 201 })
}
