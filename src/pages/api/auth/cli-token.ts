import type { APIRoute } from 'astro'
import { supabase } from '../../../lib/supabase.js'
import { registerPublicKey } from '../../../lib/tokens.js'
import { logAuditEvent } from '../../../lib/audit.js'

export const POST: APIRoute = async ({ request }) => {
  const authHeader = request.headers.get('Authorization')
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!accessToken) return new Response('Unauthorized', { status: 401 })

  const { data: { user }, error } = await supabase.auth.getUser(accessToken)
  if (error || !user) return new Response('Unauthorized', { status: 401 })

  let body: { publicKey?: string }
  try {
    body = await request.json()
  } catch {
    return new Response('Bad request: expected JSON body', { status: 400 })
  }

  if (!body.publicKey) {
    return new Response('Bad request: missing publicKey', { status: 400 })
  }

  const keyId = await registerPublicKey(user.id, body.publicKey)
  const username = (user.user_metadata?.['user_name'] as string) ?? 'unknown'

  logAuditEvent({
    userId: user.id,
    action: 'token.create',
    resourceType: 'token',
    resourceId: keyId,
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  }).catch(() => {})

  return new Response(JSON.stringify({ keyId, username }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
