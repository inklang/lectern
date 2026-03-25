import { supabase } from './supabase.js'

export type AuditAction =
  | 'package.publish'
  | 'package.unpublish'
  | 'org.create'
  | 'org.update'
  | 'org.delete'
  | 'member.add'
  | 'member.remove'
  | 'member.role_change'
  | 'team.create'
  | 'team.delete'
  | 'invite.create'
  | 'invite.accept'
  | 'invite.cancel'
  | 'token.create'
  | 'token.revoke'
  | 'webhook.create'
  | 'webhook.update'
  | 'webhook.delete'

export interface AuditEvent {
  orgId?: string | null
  userId: string
  tokenId?: string | null
  action: AuditAction
  resourceType: string
  resourceId?: string | null
  details?: Record<string, unknown>
  ipAddress?: string | null
  userAgent?: string | null
}

export interface AuditLogEntry extends AuditEvent {
  id: string
  created_at: string
}

/**
 * Log an audit event. Fire-and-forget, does not block the caller.
 */
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await supabase.from('audit_log').insert({
      org_id: event.orgId ?? null,
      user_id: event.userId,
      token_id: event.tokenId ?? null,
      action: event.action,
      resource_type: event.resourceType,
      resource_id: event.resourceId ?? null,
      details: event.details ?? null,
      ip_address: event.ipAddress ?? null,
      user_agent: event.userAgent ?? null,
    })
  } catch (err) {
    // Fire and forget — log errors but don't fail the caller
    console.error('[audit] failed to log event:', err)
  }
}

export interface AuditFilters {
  orgId?: string
  userId?: string
  action?: AuditAction
  resourceType?: string
  resourceId?: string
  from?: Date
  to?: Date
  limit?: number
  offset?: number
}

/**
 * Query audit log with filters.
 */
export async function queryAuditLog(filters: AuditFilters): Promise<{ entries: AuditLogEntry[]; total: number }> {
  let query = supabase
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (filters.orgId) query = query.eq('org_id', filters.orgId)
  if (filters.userId) query = query.eq('user_id', filters.userId)
  if (filters.action) query = query.eq('action', filters.action)
  if (filters.resourceType) query = query.eq('resource_type', filters.resourceType)
  if (filters.resourceId) query = query.eq('resource_id', filters.resourceId)
  if (filters.from) query = query.gte('created_at', filters.from.toISOString())
  if (filters.to) query = query.lte('created_at', filters.to.toISOString())

  const limit = filters.limit ?? 50
  const offset = filters.offset ?? 0
  query = query.range(offset, offset + limit - 1)

  const { data, count, error } = await query
  if (error) throw error

  return {
    entries: (data as AuditLogEntry[]) ?? [],
    total: count ?? 0,
  }
}
