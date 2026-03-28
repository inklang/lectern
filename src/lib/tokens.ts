import { createHash, verify as cryptoVerify } from 'crypto'

// ── Ink-v1 asymmetric auth ────────────────────────────────────────────────────
// Header format: Ink-v1 keyId=<hex32>,ts=<epochMs>,sig=<base64>
// Signed payload: "<keyId>:<ts>" (UTF-8 bytes)
// Replay window: 5 minutes

export interface InkV1Header {
  keyId: string
  ts: string
  sig: string
}

export function parseInkV1Header(header: string | null): InkV1Header | null {
  if (!header) return null
  const m = header.match(/^Ink-v1 keyId=([^,]+),ts=(\d+),sig=(.+)$/)
  if (!m) return null
  const age = Math.abs(Date.now() - parseInt(m[2]))
  if (age > 5 * 60 * 1000) return null
  return { keyId: m[1], ts: m[2], sig: m[3] }
}

export function verifyInkV1(keyId: string, ts: string, sigB64: string, publicKeyB64: string): boolean {
  try {
    const payload = Buffer.from(`${keyId}:${ts}`)
    const sig = Buffer.from(sigB64, 'base64')
    const pubDer = Buffer.from(publicKeyB64, 'base64')
    return cryptoVerify(null, payload, { key: pubDer, format: 'der', type: 'spki' }, sig)
  } catch {
    return false
  }
}

// Looks up a public key by keyId, returns { publicKey, userId } or null.
// Uses supabaseAnon (publishable key) — public keys are not secret.
// Updates last_used on hit (fire-and-forget via service client).
export async function resolvePublicKey(keyId: string): Promise<{ publicKey: string; userId: string } | null> {
  const { supabaseAnon, supabase } = await import('./supabase.js')
  const { data } = await supabaseAnon
    .from('cli_tokens')
    .select('public_key, user_id')
    .eq('key_id', keyId)
    .single()
  if (!data) return null
  // Fire-and-forget last_used update using service client
  supabase.from('cli_tokens').update({ last_used: new Date().toISOString() })
    .eq('key_id', keyId).then(() => {})
  return { publicKey: data.public_key, userId: data.user_id }
}

// Convenience: parse + verify in one call. Returns userId or null.
export async function resolveAuth(authHeader: string | null): Promise<string | null> {
  const parsed = parseInkV1Header(authHeader)
  if (!parsed) return null
  const entry = await resolvePublicKey(parsed.keyId)
  if (!entry) return null
  if (!verifyInkV1(parsed.keyId, parsed.ts, parsed.sig, entry.publicKey)) return null
  return entry.userId
}

// Registers a new public key for a user. Returns keyId.
export async function registerPublicKey(userId: string, publicKeyB64: string): Promise<string> {
  const { supabase } = await import('./supabase.js')
  const pubDer = Buffer.from(publicKeyB64, 'base64')
  const keyId = createHash('sha256').update(pubDer).digest('hex').slice(0, 32)
  const { error } = await supabase
    .from('cli_tokens')
    .insert({ user_id: userId, key_id: keyId, public_key: publicKeyB64 })
  if (error) throw error
  return keyId
}

// Revokes the key identified by the Ink-v1 header (must verify first).
export async function revokeKey(authHeader: string | null): Promise<boolean> {
  const parsed = parseInkV1Header(authHeader)
  if (!parsed) return false
  const entry = await resolvePublicKey(parsed.keyId)
  if (!entry) return false
  if (!verifyInkV1(parsed.keyId, parsed.ts, parsed.sig, entry.publicKey)) return false
  const { supabase } = await import('./supabase.js')
  const { error } = await supabase.from('cli_tokens').delete().eq('key_id', parsed.keyId)
  return !error
}
