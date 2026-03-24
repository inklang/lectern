export function validateToken(token: string | undefined, validTokens: string[]): boolean {
  if (!token) return false
  const bare = token.startsWith('Bearer ') ? token.slice(7) : token
  return validTokens.includes(bare)
}

export function loadTokens(): string[] {
  const raw = process.env['LECTERN_TOKENS'] ?? ''
  return raw.split(',').map(t => t.trim()).filter(Boolean)
}
