import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getPackageWebhook, deliverWebhook } from '../../../../lib/webhooks.js'

// POST /api/webhooks/[id]/test — send a test payload
export const POST: APIRoute = async ({ params, request }) => {
  const { id } = params
  if (!id) return new Response('Not found', { status: 404 })

  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY ?? ''

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() { return parseCookieHeader(request.headers.get('Cookie') ?? '') },
      setAll() {},
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const webhook = await getPackageWebhook(id, user.id)
  if (!webhook) return new Response('Not found', { status: 404 })

  // Send a test payload
  const testPayload = {
    test: true,
    message: 'This is a test webhook delivery from lectern',
    subscription_id: webhook.id,
    package_name: webhook.package_name,
  }

  const result = await deliverWebhook(webhook, 'webhook.test', testPayload)

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
    status: result.ok ? 200 : 500,
  })
}
