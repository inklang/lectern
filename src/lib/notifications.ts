import { supabase } from './supabase.js';

export type NotificationType =
  | 'new_follower'
  | 'new_org_follower'
  | 'package_starred'
  | 'package_commented'
  | 'new_version'
  | 'package_deprecated'
  | 'comment_replied';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

export async function emitNotification(
  userId: string,
  type: NotificationType,
  payload: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    user_id: userId,
    type,
    payload,
    read: false,
  });
  if (error) throw error;
}

export async function emitNotificationBatch(
  notifications: Array<{ userId: string; type: NotificationType; payload: Record<string, unknown> }>
): Promise<void> {
  const rows = notifications.map((n) => ({
    user_id: n.userId,
    type: n.type,
    payload: n.payload,
    read: false,
  }));
  const { error } = await supabase.from('notifications').insert(rows);
  if (error) throw error;
}

export async function getNotifications(
  userId: string,
  limit = 20,
  offset = 0,
  unreadOnly = false
): Promise<Notification[]> {
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (unreadOnly) {
    query = query.eq('read', false);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as Notification[];
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', notificationId);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) throw error;
}
