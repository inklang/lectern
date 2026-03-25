import { createHmac } from 'crypto'
import { supabase } from './supabase.js'

export interface WebhookDeliveryPayload {
  event: string
  timestamp: string
  data: Record<string, unknown>
}

/**
 * Deliver a webhook event to all matching webhook endpoints.
 * Uses fire-and-forget fetch with exponential backoff retry (3 attempts).
 */
export async function deliverWebhook(
  orgId: string | null,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  // Build the full payload
  const deliveryPayload: WebhookDeliveryPayload = {
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  }

  // Fetch all matching active webhooks
  let query = supabase
    .from('webhook_configs')
    .select('id, url, secret')
    .eq('active', true)
    .contains('events', [event])

  if (orgId !== null) {
    // Include org-specific webhooks AND system-wide webhooks (org_id = null)
    query = query.or(`org_id.eq.${orgId},org_id.is.null`)
  } else {
    // System-wide events only
    query = query.is('org_id', null)
  }

  const { data: webhooks, error } = await query
  if (error || !webhooks) return

  // Deliver to all webhooks in parallel (fire and forget)
  await Promise.allSettled(
    webhooks.map(webhook =>
      deliverWithRetry(webhook.url, webhook.secret, deliveryPayload)
    )
  )
}

/**
 * Deliver a single webhook with HMAC-SHA256 signature and 3 retries.
 */
async function deliverWithRetry(
  url: string,
  secret: string,
  payload: WebhookDeliveryPayload,
  attempt = 1
): Promise<void> {
  const maxAttempts = 3
  const body = JSON.stringify(payload)
  const signature = createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': payload.event,
        'X-Webhook-Delivery': crypto.randomUUID(),
      },
      body,
      // 30 second timeout
      signal: AbortSignal.timeout(30_000),
    })

    // Treat 2xx as success
    if (res.ok) return

    // Retry on 5xx or network errors; not on 4xx
    if (res.status >= 500 && attempt < maxAttempts) {
      throw new Error(`HTTP ${res.status}`)
    }
  } catch (err) {
    if (attempt >= maxAttempts) {
      console.error(`[webhook] delivery failed after ${maxAttempts} attempts to ${url}`, err)
      return
    }

    // Exponential backoff: 1s, 2s, 4s
    const delay = Math.pow(2, attempt - 1) * 1000
    await new Promise(resolve => setTimeout(resolve, delay))
    return deliverWithRetry(url, secret, payload, attempt + 1)
  }
}

// --- Management API helpers ---

export interface WebhookConfig {
  id: string
  org_id: string | null
  url: string
  events: string[]
  active: boolean
  created_at: string
}

export async function listWebhooks(orgId: string): Promise<WebhookConfig[]> {
  const { data, error } = await supabase
    .from('webhook_configs')
    .select('id, org_id, url, events, active, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createWebhook(
  orgId: string,
  url: string,
  events: string[],
  secret: string
): Promise<WebhookConfig> {
  const { data, error } = await supabase
    .from('webhook_configs')
    .insert({ org_id: orgId, url, events, secret, active: true })
    .select('id, org_id, url, events, active, created_at')
    .single()
  if (error) throw error
  return data
}

export async function updateWebhook(
  id: string,
  updates: { url?: string; events?: string[]; active?: boolean; secret?: string }
): Promise<WebhookConfig> {
  const { data, error } = await supabase
    .from('webhook_configs')
    .update(updates)
    .eq('id', id)
    .select('id, org_id, url, events, active, created_at')
    .single()
  if (error) throw error
  return data
}

export async function deleteWebhook(id: string): Promise<void> {
  const { error } = await supabase
    .from('webhook_configs')
    .delete()
    .eq('id', id)
  if (error) throw error
}
