import { supabase } from './supabase.js'
import type { User } from '@supabase/supabase-js'

export interface UserFollow {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface OrgFollow {
  id: string;
  follower_id: string;
  org_id: string;
  created_at: string;
}

export async function followUser(followerId: string, followingId: string): Promise<void> {
  const { error } = await supabase.from('user_follows').insert({
    follower_id: followerId,
    following_id: followingId,
  });
  if (error) throw error;
}

export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
  const { error } = await supabase
    .from('user_follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', followingId);
  if (error) throw error;
}

export async function getUserFollowers(
  userId: string,
  limit = 20,
  offset = 0
): Promise<UserFollow[]> {
  const { data, error } = await supabase
    .from('user_follows')
    .select('*')
    .eq('following_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data as UserFollow[];
}

export async function getUserFollowing(
  userId: string,
  limit = 20,
  offset = 0
): Promise<UserFollow[]> {
  const { data, error } = await supabase
    .from('user_follows')
    .select('*')
    .eq('follower_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data as UserFollow[];
}

export async function isFollowingUser(
  followerId: string,
  followingId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('user_follows')
    .select('id')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .single();
  return !!data;
}

export async function followOrg(followerId: string, orgId: string): Promise<void> {
  const { error } = await supabase.from('org_follows').insert({
    follower_id: followerId,
    org_id: orgId,
  });
  if (error) throw error;
}

export async function unfollowOrg(followerId: string, orgId: string): Promise<void> {
  const { error } = await supabase
    .from('org_follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('org_id', orgId);
  if (error) throw error;
}

export async function isFollowingOrg(followerId: string, orgId: string): Promise<boolean> {
  const { data } = await supabase
    .from('org_follows')
    .select('id')
    .eq('follower_id', followerId)
    .eq('org_id', orgId)
    .single();
  return !!data;
}
