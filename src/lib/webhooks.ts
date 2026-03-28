import { createHmac } from 'crypto'
import { supabase } from './supabase.js'

export interface WebhookDeliveryPayload {
  event: string
  timestamp: string
  data: Record<string, unknown>
}

// --- Package-level webhook delivery ---

export interface WebhookSubscription {
  id: string
  user_id: string
  package_name: string
  url: string
  secret: string
  events: string[]
  active: boolean
  created_at: string
}

/**
 * Emit webhooks for a package event (fire and forget).
 * Looks up all active subscriptions for the package matching the event,
 * then delivers to each endpoint in parallel.
 */
export function emitWebhooks(
  packageName: string,
  event: string,
  payload: Record<string, unknown>
): void {
  // Fire and forget — don't await
  deliverPackageWebhooks(packageName, event, payload).catch(err => {
    console.error('[webhooks] emit failed:', err)
  })
}

async function deliverPackageWebhooks(
  packageName: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  // Fetch all matching active subscriptions for this package
  const { data: subscriptions, error } = await supabase
    .from('webhook_subscriptions')
    .select('id, url, secret, user_id')
    .eq('package_name', packageName)
    .eq('active', true)
    .contains('events', [event])

  if (error || !subscriptions || subscriptions.length === 0) return

  const deliveryPayload: WebhookDeliveryPayload = {
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  }

  await Promise.allSettled(
    subscriptions.map(sub =>
      deliverPackageWebhook(sub.id, sub.url, sub.secret, deliveryPayload)
    )
  )
}

/**
 * Deliver a single webhook to a subscription endpoint.
 * Returns { ok, status, error } for logging.
 */
export async function deliverWebhook(
  subscription: WebhookSubscription,
  event: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const deliveryPayload: WebhookDeliveryPayload = {
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  }
  return deliverPackageWebhook(subscription.id, subscription.url, subscription.secret, deliveryPayload, subscription.user_id)
}

async function deliverPackageWebhook(
  subscriptionId: string,
  url: string,
  secret: string,
  payload: WebhookDeliveryPayload,
  userId?: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const maxAttempts = 3
  const body = JSON.stringify(payload)
  const signature = createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  let lastError: string | undefined
  let lastStatus: number | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ink-Signature': `sha256=${signature}`,
          'X-Ink-Event': payload.event,
          'X-Ink-Delivery': crypto.randomUUID(),
        },
        body,
        signal: AbortSignal.timeout(30_000),
      })

      lastStatus = res.status

      if (res.ok) {
        // Log successful delivery
        await logDelivery(subscriptionId, payload, lastStatus, undefined, undefined)
        return { ok: true, status: lastStatus }
      }

      // 4xx = client error, don't retry
      if (res.status >= 400 && res.status < 500) {
        const responseBody = await res.text().catch(() => '')
        await logDelivery(subscriptionId, payload, lastStatus, responseBody, `HTTP ${res.status}`)
        return { ok: false, status: lastStatus, error: `HTTP ${res.status}` }
      }

      // 5xx = server error, retry
      lastError = `HTTP ${res.status}`
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt - 1) * 60_000 // 1min, 2min, 4min
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
    } catch (err) {
      lastError = String(err)
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt - 1) * 60_000
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  // Log failed delivery
  await logDelivery(subscriptionId, payload, lastStatus, undefined, lastError)
  return { ok: false, status: lastStatus, error: lastError }
}

async function logDelivery(
  subscriptionId: string,
  payload: WebhookDeliveryPayload,
  responseStatus: number | undefined,
  responseBody: string | undefined,
  error: string | undefined
): Promise<void> {
  // Compute next retry time if failed
  let nextRetryAt: string | undefined
  if (error) {
    // Don't schedule retries here — simple 3-attempt retry with backoff handled in deliverPackageWebhook
    // This is just for logging; next_retry_at can be used by a background worker later
  }

  await supabase.from('webhook_deliveries').insert({
    subscription_id: subscriptionId,
    event: payload.event,
    payload: payload as any,
    response_status: responseStatus,
    response_body: responseBody ? responseBody.slice(0, 1000) : undefined,
    error,
    next_retry_at: nextRetryAt,
  }).catch(err => {
    console.error('[webhooks] failed to log delivery:', err)
  })
}

// --- Org-level webhook delivery (existing) ---

/**
 * Deliver a webhook event to all matching org webhook endpoints.
 * Uses fire-and-forget fetch with exponential backoff retry (3 attempts).
 */
export async function deliverOrgWebhook(
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

// --- Package-level webhook subscription management ---

export interface PackageWebhookSubscription {
  id: string
  user_id: string
  package_name: string
  url: string
  events: string[]
  active: boolean
  created_at: string
}

export async function listPackageWebhooks(userId: string): Promise<PackageWebhookSubscription[]> {
  const { data, error } = await supabase
    .from('webhook_subscriptions')
    .select('id, user_id, package_name, url, events, active, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PackageWebhookSubscription[]
}

export async function listPackageWebhooksForPackage(packageName: string): Promise<PackageWebhookSubscription[]> {
  const { data, error } = await supabase
    .from('webhook_subscriptions')
    .select('id, user_id, package_name, url, events, active, created_at')
    .eq('package_name', packageName)
    .eq('active', true)
  if (error) throw error
  return (data ?? []) as PackageWebhookSubscription[]
}

export async function createPackageWebhook(
  userId: string,
  packageName: string,
  url: string,
  events: string[],
  secret: string
): Promise<PackageWebhookSubscription> {
  const { data, error } = await supabase
    .from('webhook_subscriptions')
    .insert({ user_id: userId, package_name: packageName, url, events, secret, active: true })
    .select('id, user_id, package_name, url, events, active, created_at')
    .single()
  if (error) throw error
  return data as PackageWebhookSubscription
}

export async function updatePackageWebhook(
  id: string,
  userId: string,
  updates: { url?: string; events?: string[]; active?: boolean }
): Promise<PackageWebhookSubscription> {
  const { data, error } = await supabase
    .from('webhook_subscriptions')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select('id, user_id, package_name, url, events, active, created_at')
    .single()
  if (error) throw error
  return data as PackageWebhookSubscription
}

export async function deletePackageWebhook(id: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('webhook_subscriptions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw error
}

export async function getPackageWebhook(id: string, userId: string): Promise<PackageWebhookSubscription | null> {
  const { data, error } = await supabase
    .from('webhook_subscriptions')
    .select('id, user_id, package_name, url, events, active, created_at')
    .eq('id', id)
    .eq('user_id', userId)
    .single()
  if (error) return null
  return data as PackageWebhookSubscription
}

export async function getLastDelivery(subscriptionId: string): Promise<{
  attempted_at: string
  response_status: number | null
  error: string | null
} | null> {
  const { data, error } = await supabase
    .from('webhook_deliveries')
    .select('attempted_at, response_status, error')
    .eq('subscription_id', subscriptionId)
    .order('attempted_at', { ascending: false })
    .limit(1)
    .single()
  if (error || !data) return null
  return data
}
