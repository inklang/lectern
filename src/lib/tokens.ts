import { createHash } from 'crypto'

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function verifyToken(raw: string, hash: string): boolean {
  return hashToken(raw) === hash
}

export function extractBearer(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

// Looks up a CLI token, returns user_id or null. Updates last_used on hit.
export async function resolveToken(raw: string): Promise<string | null> {
  const { supabase } = await import('./supabase.js')
  const hash = hashToken(raw)
  const { data } = await supabase
    .from('cli_tokens')
    .select('user_id, id')
    .eq('token_hash', hash)
    .single()
  if (!data) return null

  // Update last_used (fire and forget)
  supabase.from('cli_tokens').update({ last_used: new Date().toISOString() })
    .eq('id', data.id).then(() => {})

  return data.user_id
}

// Stores a new CLI token. Returns the raw token.
export async function issueToken(userId: string): Promise<string> {
  const { supabase } = await import('./supabase.js')
  const { randomBytes } = await import('crypto')
  const raw = randomBytes(32).toString('hex')
  const hash = hashToken(raw)
  const { error } = await supabase
    .from('cli_tokens')
    .insert({ user_id: userId, token_hash: hash })
  if (error) throw error
  return raw
}

// Revokes a CLI token by raw value.
export async function revokeToken(raw: string): Promise<boolean> {
  const { supabase } = await import('./supabase.js')
  const hash = hashToken(raw)
  const { error } = await supabase
    .from('cli_tokens')
    .delete()
    .eq('token_hash', hash)
  return !error
}
