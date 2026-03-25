import { createHash, randomBytes } from 'crypto'
import { supabase } from './supabase.js'

export interface TokenScopes {
  packages_read: boolean
  packages_publish: boolean
  packages_delete: boolean
  orgs_read: boolean
  orgs_manage: boolean
  orgs_delete: boolean
  teams_read: boolean
  teams_manage: boolean
  tokens_read: boolean
  tokens_write: boolean
}

export interface ApiToken {
  id: string
  user_id: string
  name: string
  token_prefix: string
  scopes: TokenScopes
  token_type: 'read' | 'publish' | 'org:manage' | 'admin'
  rate_limit: number | null
  rate_limit_burst: number
  expires_at: string | null
  description: string | null
  last_used_at: string | null
  last_used_ip: string | null
  created_at: string
  org_id: string | null
}

export interface ListedToken {
  id: string
  user_id: string
  name: string
  token_prefix: string
  scopes: TokenScopes
  token_type: 'read' | 'publish' | 'org:manage' | 'admin'
  rate_limit: number | null
  expires_at: string | null
  description: string | null
  last_used_at: string | null
  created_at: string
  org_id: string | null
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function generateRawToken(): string {
  const bytes = randomBytes(32)
  return 'lectern_' + bytes.toString('base64url')
}

export function extractPrefix(raw: string): string {
  // Return first 12 chars: "lectern_" (8) + first 4 of payload
  return raw.slice(0, 12)
}

export function determineTokenType(scopes: TokenScopes): 'read' | 'publish' | 'org:manage' | 'admin' {
  if (scopes.tokens_write && scopes.orgs_delete) return 'admin'
  if (scopes.orgs_manage || scopes.teams_manage) return 'org:manage'
  if (scopes.packages_publish) return 'publish'
  return 'read'
}

export async function issueApiToken(
  userId: string,
  name: string,
  scopes: TokenScopes,
  options?: {
    description?: string
    expiresIn?: number | null
    rateLimit?: number | null
    orgId?: string | null
  }
): Promise<{ token: ApiToken; raw: string }> {
  const raw = generateRawToken()
  const hash = hashToken(raw)
  const prefix = extractPrefix(raw)
  const tokenType = determineTokenType(scopes)
  const expiresAt = options?.expiresIn
    ? new Date(Date.now() + options.expiresIn * 1000).toISOString()
    : null

  const { data, error } = await supabase
    .from('api_tokens')
    .insert({
      user_id: userId,
      name,
      token_hash: hash,
      token_prefix: prefix,
      scopes,
      token_type: tokenType,
      expires_at: expiresAt,
      rate_limit: options?.rateLimit ?? null,
      description: options?.description ?? null,
      org_id: options?.orgId ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return { token: data as ApiToken, raw }
}

export async function resolveApiToken(raw: string): Promise<{
  userId: string | null
  orgId: string | null
  scopes: TokenScopes | null
  tokenType: string | null
  rateLimit: number | null
  tokenId: string | null
} | null> {
  const hash = hashToken(raw)
  const now = new Date().toISOString()

  const { data } = await supabase
    .from('api_tokens')
    .select('id, user_id, org_id, scopes, token_type, rate_limit, expires_at')
    .eq('token_hash', hash)
    .single()

  if (!data) return null
  if (data.expires_at && data.expires_at < now) return null

  return {
    userId: data.user_id,
    orgId: data.org_id,
    scopes: data.scopes,
    tokenType: data.token_type,
    rateLimit: data.rate_limit,
    tokenId: data.id,
  }
}

export async function revokeApiToken(tokenId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('api_tokens')
    .delete()
    .eq('id', tokenId)
    .eq('user_id', userId)
  return !error
}

export async function listApiTokens(userId: string): Promise<ListedToken[]> {
  const { data } = await supabase
    .from('api_tokens')
    .select('id, user_id, name, token_prefix, scopes, token_type, rate_limit, expires_at, description, last_used_at, created_at, org_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  return (data as ListedToken[]) ?? []
}

export async function getApiToken(tokenId: string, userId: string): Promise<ApiToken | null> {
  const { data } = await supabase
    .from('api_tokens')
    .select('*')
    .eq('id', tokenId)
    .eq('user_id', userId)
    .single()
  return data as ApiToken ?? null
}

export async function listOrgApiTokens(orgId: string): Promise<Array<ListedToken & { user_email?: string }>> {
  const { data } = await supabase
    .from('api_tokens')
    .select('id, user_id, name, token_prefix, scopes, token_type, rate_limit, expires_at, description, last_used_at, created_at, org_id')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  const tokens = (data as ListedToken[]) ?? []

  // Fetch user emails for each token
  if (tokens.length > 0) {
    const userIds = [...new Set(tokens.map(t => t.user_id))]
    const { data: users } = await supabase
      .from('users')
      .select('id, email')
      .in('id', userIds)

    const userEmailMap: Record<string, string> = {}
    if (users) {
      for (const u of users) {
        userEmailMap[u.id] = u.email
      }
    }

    return tokens.map(t => ({
      ...t,
      user_email: userEmailMap[t.user_id] ?? null,
    }))
  }

  return tokens
}

export async function revokeOrgApiToken(tokenId: string, orgId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('api_tokens')
    .delete()
    .eq('id', tokenId)
    .eq('org_id', orgId)
  return !error
}

export async function updateTokenLastUsed(tokenId: string, ipAddress?: string): Promise<void> {
  await supabase
    .from('api_tokens')
    .update({
      last_used_at: new Date().toISOString(),
      last_used_ip: ipAddress ?? null,
    })
    .eq('id', tokenId)
}
