import type { APIRoute } from 'astro'
import { supabase } from '../../../lib/supabase.js'
import { issueToken, extractBearer } from '../../../lib/tokens.js'

export const POST: APIRoute = async ({ request }) => {
  const accessToken = extractBearer(request.headers.get('Authorization'))
  if (!accessToken) return new Response('Unauthorized', { status: 401 })

  const { data: { user }, error } = await supabase.auth.getUser(accessToken)
  if (error || !user) return new Response('Unauthorized', { status: 401 })

  const token = await issueToken(user.id)
  const username = (user.user_metadata?.['user_name'] as string) ?? 'unknown'

  return new Response(JSON.stringify({ token, username }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}
