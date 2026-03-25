# Community Features Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three interconnected community features: follow system (user/org follows), in-app notification feed, and lite flat comments on packages.

**Architecture:**
- Follow system: `user_follows` and `org_follows` tables, RLS-policied
- Notifications: `notifications` table with service-role-only inserts via admin supabase client in API routes
- Comments: `package_comments` table, flat top-level only (replies stored but not displayed)
- All new tables live in `public` schema; no schema migrations beyond new tables

**Tech Stack:** Astro 6 SSR, Supabase Postgres, TypeScript, Vitest for tests

---

## File Map

### New files
- `supabase/migrations/014_community_features.sql` — all new tables, indexes, RLS policies
- `src/lib/follows.ts` — follow/unfollow/user/org DB functions
- `src/lib/notifications.ts` — `emitNotification` helper + notification query functions
- `src/pages/api/users/[username]/follow.ts` — POST/DELETE follow-user + GET followers/following
- `src/pages/api/orgs/[slug]/follow.ts` — POST/DELETE follow-org + GET org followers
- `src/pages/api/notifications/index.ts` — GET notifications + POST mark-all-read
- `src/pages/api/notifications/[id]/read.ts` — POST mark-single-read
- `src/pages/api/packages/[name]/comments/index.ts` — GET/POST for comments
- `src/pages/api/packages/[name]/comments/[id].ts` — DELETE for single comment
- `src/pages/notifications.astro` — notification feed page
- `src/lib/follows.test.ts` — unit tests for follow DB functions
- `src/lib/notifications.test.ts` — unit tests for emitNotification
- `src/pages/api/users/[username]/follow.test.ts` — unit tests for follow API
- `src/pages/api/packages/[name]/comments/index.test.ts` — unit tests for comments API

### Modified files
- `src/pages/packages/[name].astro` — add comments section below changelog
- `src/pages/[slug]/index.astro` — add Followers/Following tabs
- `src/pages/api/packages/[name]/star.ts` — emit `package_starred` notifications
- `src/pages/api/packages/[name]/deprecate.ts` — emit `package_deprecated` notifications

---

## Chunk 1: Database Migration

**Files touched:**
- Create: `supabase/migrations/014_community_features.sql`

---

### Task 1: Create the community features migration

**Files:**
- Create: `supabase/migrations/014_community_features.sql`

- [ ] **Step 1: Create the migration file**

Run:
```bash
ls supabase/migrations/
```
Expected: Lists existing migrations `001_initial.sql` through `013_org_avatars_banners.sql`. Next available is `014`.

Run:
```bash
cat > supabase/migrations/014_community_features.sql << 'EOF'
-- Follow system
create table user_follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid references auth.users on delete cascade not null,
  following_id uuid references auth.users on delete cascade not null,
  created_at   timestamptz default now(),
  unique (follower_id, following_id)
);

create table org_follows (
  id          uuid primary key default gen_random_uuid(),
  follower_id uuid references auth.users on delete cascade not null,
  org_id     uuid references orgs on delete cascade not null,
  created_at timestamptz default now(),
  unique (follower_id, org_id)
);

-- Notifications
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users on delete cascade not null,
  type       text not null,
  payload    jsonb not null,
  read       boolean default false,
  created_at timestamptz default now()
);

create index notifications_user_created on notifications (user_id, created_at desc);

-- Comments
create table package_comments (
  id           uuid primary key default gen_random_uuid(),
  package_name text not null,
  user_id      uuid references auth.users on delete cascade not null,
  body         text not null,
  parent_id    uuid references package_comments on delete cascade,
  deleted      boolean default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index package_comments_package on package_comments (package_name, created_at asc);

-- RLS
alter table user_follows enable row level security;
alter table org_follows enable row level security;
alter table notifications enable row level security;
alter table package_comments enable row level security;

-- user_follows: anyone can read; auth users manage their own
create policy "public read user_follows" on user_follows for select using (true);
create policy "users manage own follows" on user_follows for all using (auth.uid() = follower_id);

-- org_follows: anyone can read; auth users manage their own
create policy "public read org_follows" on org_follows for select using (true);
create policy "users manage own org follows" on org_follows for all using (auth.uid() = follower_id);

-- notifications: users read their own; service role inserts
create policy "users read own notifications" on notifications for select using (auth.uid() = user_id);
create policy "service role can insert notifications" on notifications for insert with check (true);

-- package_comments: public read non-deleted; authors manage their own
create policy "public read package_comments" on package_comments for select using (deleted = false);
create policy "users manage own comments" on package_comments for all using (auth.uid() = user_id);
EOF
```

- [ ] **Step 2: Apply the migration**

Run:
```bash
npx supabase db push
```
Expected: Success message showing 14 tables created (existing 13 + 4 new tables, but some existing tables share names so net new count differs).

- [ ] **Step 3: Verify tables exist**

Run:
```bash
npx supabase db query "\dt"
```
Expected: Output includes `user_follows`, `org_follows`, `notifications`, `package_comments`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/014_community_features.sql
git commit -m "feat: add community features migration - follows, notifications, comments"
```

---

## Chunk 2: Follow DB Library and Notifications Library

**Files touched:**
- Create: `src/lib/follows.ts`
- Create: `src/lib/follows.test.ts`
- Create: `src/lib/notifications.ts`
- Create: `src/lib/notifications.test.ts`

---

### Task 1: Write failing tests for `follows.ts`

**Files:**
- Create: `src/lib/follows.test.ts`

- [ ] **Step 1: Write the failing test file**

```typescript
// src/lib/follows.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase.js', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

const { supabase } = await import('./supabase.js')

describe('follows.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('followUser', () => {
    it('calls supabase.from with user_follows and upsert', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({ error: null })
      vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as any)

      const { followUser } = await import('./follows.js')
      await followUser('follower-uuid', 'following-uuid')

      expect(supabase.from).toHaveBeenCalledWith('user_follows')
      expect(mockUpsert).toHaveBeenCalledWith(
        { follower_id: 'follower-uuid', following_id: 'following-uuid' },
        { onConflict: 'follower_id,following_id' }
      )
    })

    it('throws if upsert returns an error', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({ error: { message: 'boom' } })
      vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as any)

      const { followUser } = await import('./follows.js')
      await expect(followUser('f', 't')).rejects.toThrow('boom')
    })
  })

  describe('unfollowUser', () => {
    it('calls supabase.from with user_follows and delete', async () => {
      const mockDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ error: null }),
      })
      vi.mocked(supabase.from).mockReturnValue({ delete: mockDelete } as any)

      const { unfollowUser } = await import('./follows.js')
      await unfollowUser('follower-uuid', 'following-uuid')

      expect(supabase.from).toHaveBeenCalledWith('user_follows')
      expect(mockDelete).toHaveBeenCalled()
      expect(mockDelete().eq).toHaveBeenCalledWith('follower_id', 'follower-uuid')
      expect(mockDelete().eq().eq).toHaveBeenCalledWith('following_id', 'following-uuid')
    })
  })

  describe('isFollowingUser', () => {
    it('returns true when data exists', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'x' } }),
          }),
        }),
      })
      vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as any)

      const { isFollowingUser } = await import('./follows.js')
      const result = await isFollowingUser('f', 't')

      expect(result).toBe(true)
    })

    it('returns false when no data', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
      })
      vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as any)

      const { isFollowingUser } = await import('./follows.js')
      const result = await isFollowingUser('f', 't')

      expect(result).toBe(false)
    })
  })

  describe('getUserFollowers', () => {
    it('returns formatted user rows with total count', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockResolvedValue({
              data: [
                {
                  follower_id: 'u1',
                  created_at: '2024-01-01T00:00:00Z',
                  auth: { users: { raw_user_meta_data: { user_name: 'alice', avatar_url: 'https://x.com/alice.jpg' } } },
                },
              ],
              count: 42,
              error: null,
            }),
          }),
        }),
      })
      vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as any)

      const { getUserFollowers } = await import('./follows.js')
      const result = await getUserFollowers('target-user-id', 20, 0)

      expect(result.total).toBe(42)
      expect(result.users[0]).toEqual({
        userId: 'u1',
        username: 'alice',
        avatarUrl: 'https://x.com/alice.jpg',
        followedAt: '2024-01-01T00:00:00Z',
      })
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /c/Users/justi/dev/lectern && npx vitest run src/lib/follows.test.ts
```
Expected: FAIL — "Cannot find module './follows.js'" or similar (file doesn't exist yet).

---

### Task 2: Write minimal `follows.ts` implementation

**Files:**
- Create: `src/lib/follows.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/lib/follows.ts
import { supabase } from './supabase.js'

// ─── User Follows ─────────────────────────────────────────────────────────────

/** Follow a user. Idempotent (no error if already following). */
export async function followUser(followerId: string, followingId: string): Promise<void> {
  const { error } = await supabase
    .from('user_follows')
    .upsert(
      { follower_id: followerId, following_id: followingId },
      { onConflict: 'follower_id,following_id' }
    )
  if (error) throw error
}

/** Unfollow a user. Idempotent. */
export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
  const { error } = await supabase
    .from('user_follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
  if (error) throw error
}

/** Returns true if followerId is following followingId. */
export async function isFollowingUser(followerId: string, followingId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_follows')
    .select('id')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .single()
  return !!data
}

export interface FollowUserRow {
  userId: string
  username: string
  avatarUrl: string | null
  followedAt: string
}

/** Paginated followers for a user. */
export async function getUserFollowers(
  userId: string,
  limitCount = 20,
  offsetCount = 0
): Promise<{ users: FollowUserRow[]; total: number }> {
  const { data, count, error } = await supabase
    .from('user_follows')
    .select(
      `id, follower_id, created_at,
       auth.users!user_follows_follower_id_fkey (
         id,
         raw_user_meta_data
       )`,
      { count: 'exact' }
    )
    .eq('following_id', userId)
    .order('created_at', { ascending: false })
    .range(offsetCount, offsetCount + limitCount - 1)
  if (error) throw error

  const users: FollowUserRow[] = (data ?? []).map((row: any) => ({
    userId: row.follower_id,
    username:
      row.auth?.users?.raw_user_meta_data?.full_name ??
      row.auth?.users?.raw_user_meta_data?.user_name ??
      'unknown',
    avatarUrl: row.auth?.users?.raw_user_meta_data?.avatar_url ?? null,
    followedAt: row.created_at,
  }))

  return { users, total: count ?? 0 }
}

/** Paginated following for a user. */
export async function getUserFollowing(
  userId: string,
  limitCount = 20,
  offsetCount = 0
): Promise<{ users: FollowUserRow[]; total: number }> {
  const { data, count, error } = await supabase
    .from('user_follows')
    .select(
      `id, following_id, created_at,
       auth.users!user_follows_following_id_fkey (
         id,
         raw_user_meta_data
       )`,
      { count: 'exact' }
    )
    .eq('follower_id', userId)
    .order('created_at', { ascending: false })
    .range(offsetCount, offsetCount + limitCount - 1)
  if (error) throw error

  const users: FollowUserRow[] = (data ?? []).map((row: any) => ({
    userId: row.following_id,
    username:
      row.auth?.users?.raw_user_meta_data?.full_name ??
      row.auth?.users?.raw_user_meta_data?.user_name ??
      'unknown',
    avatarUrl: row.auth?.users?.raw_user_meta_data?.avatar_url ?? null,
    followedAt: row.created_at,
  }))

  return { users, total: count ?? 0 }
}

// ─── Org Follows ──────────────────────────────────────────────────────────────

/** Follow an org. Idempotent. */
export async function followOrg(followerId: string, orgId: string): Promise<void> {
  const { error } = await supabase
    .from('org_follows')
    .upsert(
      { follower_id: followerId, org_id: orgId },
      { onConflict: 'follower_id,org_id' }
    )
  if (error) throw error
}

/** Unfollow an org. Idempotent. */
export async function unfollowOrg(followerId: string, orgId: string): Promise<void> {
  const { error } = await supabase
    .from('org_follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('org_id', orgId)
  if (error) throw error
}

/** Returns true if followerId is following orgId. */
export async function isFollowingOrg(followerId: string, orgId: string): Promise<boolean> {
  const { data } = await supabase
    .from('org_follows')
    .select('id')
    .eq('follower_id', followerId)
    .eq('org_id', orgId)
    .single()
  return !!data
}

/** Paginated followers for an org. */
export async function getOrgFollowers(
  orgId: string,
  limitCount = 20,
  offsetCount = 0
): Promise<{ users: FollowUserRow[]; total: number }> {
  const { data, count, error } = await supabase
    .from('org_follows')
    .select(
      `id, follower_id, created_at,
       auth.users!org_follows_follower_id_fkey (
         id,
         raw_user_meta_data
       )`,
      { count: 'exact' }
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .range(offsetCount, offsetCount + limitCount - 1)
  if (error) throw error

  const users: FollowUserRow[] = (data ?? []).map((row: any) => ({
    userId: row.follower_id,
    username:
      row.auth?.users?.raw_user_meta_data?.full_name ??
      row.auth?.users?.raw_user_meta_data?.user_name ??
      'unknown',
    avatarUrl: row.auth?.users?.raw_user_meta_data?.avatar_url ?? null,
    followedAt: row.created_at,
  }))

  return { users, total: count ?? 0 }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd /c/Users/justi/dev/lectern && npx vitest run src/lib/follows.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/follows.ts src/lib/follows.test.ts
git commit -m "feat: add follows library with follow/unfollow/query functions"
```

---

### Task 3: Write failing tests for `notifications.ts`

**Files:**
- Create: `src/lib/notifications.test.ts`

- [ ] **Step 1: Write the failing test file**

```typescript
// src/lib/notifications.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase.js', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

const { supabase } = await import('./supabase.js')

describe('notifications.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('emitNotification', () => {
    it('inserts notification with correct fields', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null })
      vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as any)

      const { emitNotification } = await import('./notifications.js')
      await emitNotification('user-123', 'new_follower', {
        followerId: 'alice-uuid',
        followerUsername: 'alice',
      })

      expect(supabase.from).toHaveBeenCalledWith('notifications')
      expect(mockInsert).toHaveBeenCalledWith({
        user_id: 'user-123',
        type: 'new_follower',
        payload: { followerId: 'alice-uuid', followerUsername: 'alice' },
        read: false,
      })
    })

    it('throws if insert fails', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: { message: 'boom' } })
      vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as any)

      const { emitNotification } = await import('./notifications.js')
      await expect(
        emitNotification('u', 'new_follower', {})
      ).rejects.toThrow('boom')
    })
  })

  describe('emitNotificationBatch', () => {
    it('inserts one row per userId', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null })
      vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as any)

      const { emitNotificationBatch } = await import('./notifications.js')
      await emitNotificationBatch(
        ['u1', 'u2'],
        'new_version',
        { packageName: 'my-pkg', version: '2.0.0' }
      )

      expect(mockInsert).toHaveBeenCalledWith([
        { user_id: 'u1', type: 'new_version', payload: { packageName: 'my-pkg', version: '2.0.0' }, read: false },
        { user_id: 'u2', type: 'new_version', payload: { packageName: 'my-pkg', version: '2.0.0' }, read: false },
      ])
    })

    it('does nothing for empty userIds array', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null })
      vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as any)

      const { emitNotificationBatch } = await import('./notifications.js')
      await emitNotificationBatch([], 'new_version', {})

      expect(mockInsert).not.toHaveBeenCalled()
    })
  })

  describe('getNotifications', () => {
    it('returns notifications with unreadCount', async () => {
      // Mock main query
      const mockMainSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockResolvedValue({
              data: [
                { id: 'n1', user_id: 'u1', type: 'new_follower', payload: {}, read: false, created_at: '2024-01-01T00:00:00Z' },
              ],
              count: 1,
              error: null,
            }),
          }),
        }),
      })
      // Mock unread count query
      const mockUnreadSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ count: 5 }),
          }),
        }),
      })
      vi.mocked(supabase.from)
        .mockReturnValueOnce({ select: mockMainSelect } as any)
        .mockReturnValueOnce({ select: mockUnreadSelect } as any)

      const { getNotifications } = await import('./notifications.js')
      const result = await getNotifications('u1', { limit: 20, offset: 0 })

      expect(result.total).toBe(1)
      expect(result.unreadCount).toBe(5)
      expect(result.notifications[0].id).toBe('n1')
      expect(result.notifications[0].type).toBe('new_follower')
    })
  })

  describe('markNotificationRead', () => {
    it('returns true when a row is updated', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ count: 1 }),
        }),
      })
      vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as any)

      const { markNotificationRead } = await import('./notifications.js')
      const result = await markNotificationRead('u1', 'n1')

      expect(result).toBe(true)
    })

    it('returns false when no row updated', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ count: 0 }),
        }),
      })
      vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as any)

      const { markNotificationRead } = await import('./notifications.js')
      const result = await markNotificationRead('u1', 'n-nonexistent')

      expect(result).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /c/Users/justi/dev/lectern && npx vitest run src/lib/notifications.test.ts
```
Expected: FAIL — "Cannot find module './notifications.js'"

---

### Task 4: Write minimal `notifications.ts` implementation

**Files:**
- Create: `src/lib/notifications.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/lib/notifications.ts
import { supabase } from './supabase.js'

export type NotificationType =
  | 'new_follower'
  | 'new_org_follower'
  | 'package_starred'
  | 'package_commented'
  | 'new_version'
  | 'comment_replied'
  | 'package_deprecated'

export interface NotificationPayload {
  followerId?: string
  followerUsername?: string
  orgSlug?: string
  starrerId?: string
  starrerUsername?: string
  packageName?: string
  commenterId?: string
  commenterUsername?: string
  commentId?: string
  parentId?: string
  bodyPreview?: string
  publisherId?: string
  publisherUsername?: string
  version?: string
  deprecatorId?: string
  deprecatorUsername?: string
  message?: string
}

export interface Notification {
  id: string
  userId: string
  type: NotificationType
  payload: NotificationPayload
  read: boolean
  createdAt: string
}

/**
 * Insert a notification using the admin client (bypasses RLS).
 */
export async function emitNotification(
  userId: string,
  type: NotificationType,
  payload: NotificationPayload
): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      type,
      payload,
      read: false,
    })
  if (error) throw error
}

/**
 * Batch-insert notifications for multiple users.
 */
export async function emitNotificationBatch(
  userIds: string[],
  type: NotificationType,
  payload: NotificationPayload
): Promise<void> {
  if (userIds.length === 0) return
  const rows = userIds.map(userId => ({
    user_id: userId,
    type,
    payload,
    read: false,
  }))
  const { error } = await supabase.from('notifications').insert(rows)
  if (error) throw error
}

/**
 * Get notifications for a user with pagination.
 */
export async function getNotifications(
  userId: string,
  options: { limit?: number; offset?: number; unreadOnly?: boolean } = {}
): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
  const { limit = 20, offset = 0, unreadOnly = false } = options

  let query = supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (unreadOnly) query = query.eq('read', false)

  const { data, count, error } = await query
  if (error) throw error

  const { count: unreadCount } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false)

  const notifications: Notification[] = (data ?? []).map(row => ({
    id: row.id,
    userId: row.user_id,
    type: row.type as NotificationType,
    payload: row.payload as NotificationPayload,
    read: row.read,
    createdAt: row.created_at,
  }))

  return { notifications, total: count ?? 0, unreadCount: unreadCount ?? 0 }
}

/**
 * Mark a single notification as read. Returns true if a row was updated.
 */
export async function markNotificationRead(userId: string, notificationId: string): Promise<boolean> {
  const { count } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('id', notificationId)
    .select('*', { count: 'exact', head: true })
  return (count ?? 0) > 0
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false)
  if (error) throw error
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd /c/Users/justi/dev/lectern && npx vitest run src/lib/notifications.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/notifications.ts src/lib/notifications.test.ts
git commit -m "feat: add notifications library with emit/get/mark functions"
```

---

## Chunk 3: Follow API Routes

**Files touched:**
- Create: `src/pages/api/users/[username]/follow.ts`
- Create: `src/pages/api/users/[username]/follow.test.ts`
- Create: `src/pages/api/orgs/[slug]/follow.ts`

---

### Task 1: Write failing tests for user follow API

**Files:**
- Create: `src/pages/api/users/[username]/follow.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/pages/api/users/[username]/follow.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../lib/follows.js', () => ({
  followUser: vi.fn(),
  unfollowUser: vi.fn(),
  isFollowingUser: vi.fn(),
  getUserFollowers: vi.fn(),
  getUserFollowing: vi.fn(),
}))

vi.mock('../../../../lib/notifications.js', () => ({
  emitNotification: vi.fn(),
}))

vi.mock('../../../../lib/orgs.js', () => ({
  getUserByUsername: vi.fn(),
  getOrgBySlug: vi.fn(),
}))

vi.mock('../../../../lib/supabase.js', () => ({
  supabase: { auth: { admin: { getUserById: vi.fn() } } },
}))

const mockGetSession = vi.fn()
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mockGetSession, getSession: mockGetSession },
  })),
  parseCookieHeader: vi.fn(() => []),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/users/[username]/follow', () => {
  it('returns 401 when not logged in', async () => {
    mockGetSession.mockResolvedValue({ data: { user: null } })

    const { POST } = await import('./follow.js')
    const response = await POST({
      params: { username: 'alice' },
      request: new Request('http://localhost/api/users/alice/follow'),
    } as any)

    expect(response.status).toBe(401)
  })

  it('returns 400 when following yourself', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'me-uuid' } } })

    const { getUserByUsername } = await import('../../../../lib/orgs.js')
    vi.mocked(getUserByUsername).mockResolvedValue({ id: 'me-uuid', user_name: 'me' } as any)

    const { POST } = await import('./follow.js')
    const response = await POST({
      params: { username: 'me' },
      request: new Request('http://localhost/api/users/me/follow'),
    } as any)

    expect(response.status).toBe(400)
  })

  it('returns 204 when already following (idempotent)', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'me-uuid' } } })

    const { getUserByUsername } = await import('../../../../lib/orgs.js')
    vi.mocked(getUserByUsername).mockResolvedValue({ id: 'other-uuid', user_name: 'alice' } as any)

    const { isFollowingUser } = await import('../../../../lib/follows.js')
    vi.mocked(isFollowingUser).mockResolvedValue(true)

    const { POST } = await import('./follow.js')
    const response = await POST({
      params: { username: 'alice' },
      request: new Request('http://localhost/api/users/alice/follow'),
    } as any)

    expect(response.status).toBe(204)
  })

  it('returns 201 and calls followUser + emitNotification on success', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'me-uuid' } } })

    const { getUserByUsername } = await import('../../../../lib/orgs.js')
    vi.mocked(getUserByUsername).mockResolvedValue({ id: 'other-uuid', user_name: 'alice' } as any)

    const { isFollowingUser } = await import('../../../../lib/follows.js')
    vi.mocked(isFollowingUser).mockResolvedValue(false)

    const { followUser } = await import('../../../../lib/follows.js')
    vi.mocked(followUser).mockResolvedValue(undefined)

    const { emitNotification } = await import('../../../../lib/notifications.js')

    const { POST } = await import('./follow.js')
    const response = await POST({
      params: { username: 'alice' },
      request: new Request('http://localhost/api/users/alice/follow'),
    } as any)

    expect(response.status).toBe(201)
    expect(followUser).toHaveBeenCalledWith('me-uuid', 'other-uuid')
    expect(emitNotification).toHaveBeenCalledWith(
      'other-uuid',
      'new_follower',
      expect.objectContaining({ followerId: 'me-uuid' })
    )
  })
})

describe('DELETE /api/users/[username]/follow', () => {
  it('returns 401 when not logged in', async () => {
    mockGetSession.mockResolvedValue({ data: { user: null } })

    const { DELETE } = await import('./follow.js')
    const response = await DELETE({
      params: { username: 'alice' },
      request: new Request('http://localhost/api/users/alice/follow', { method: 'DELETE' }),
    } as any)

    expect(response.status).toBe(401)
  })

  it('returns 204 even when not following (idempotent)', async () => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'me-uuid' } } })

    const { getUserByUsername } = await import('../../../../lib/orgs.js')
    vi.mocked(getUserByUsername).mockResolvedValue({ id: 'other-uuid', user_name: 'alice' } as any)

    const { unfollowUser } = await import('../../../../lib/follows.js')
    vi.mocked(unfollowUser).mockResolvedValue(undefined)

    const { DELETE } = await import('./follow.js')
    const response = await DELETE({
      params: { username: 'alice' },
      request: new Request('http://localhost/api/users/alice/follow', { method: 'DELETE' }),
    } as any)

    expect(response.status).toBe(204)
  })
})

describe('GET /api/users/[username]/follow', () => {
  it('returns paginated followers list', async () => {
    const { getUserFollowers } = await import('../../../../lib/follows.js')
    vi.mocked(getUserFollowers).mockResolvedValue({
      users: [{ userId: 'u1', username: 'alice', avatarUrl: null, followedAt: '2024-01-01T00:00:00Z' }],
      total: 1,
    })

    const { getUserByUsername } = await import('../../../../lib/orgs.js')
    vi.mocked(getUserByUsername).mockResolvedValue({ id: 'target-uuid', user_name: 'bob' } as any)

    const { GET } = await import('./follow.js')
    const url = new URL('http://localhost/api/users/bob/follow?tab=followers&limit=20&offset=0')
    const response = await GET({
      params: { username: 'bob' },
      request: new Request(url),
    } as any)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.users).toHaveLength(1)
    expect(body.total).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /c/Users/justi/dev/lectern && npx vitest run src/pages/api/users/[username]/follow.test.ts
```
Expected: FAIL — module not found

---

### Task 2: Write minimal user follow API

**Files:**
- Create: `src/pages/api/users/[username]/follow.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/pages/api/users/[username]/follow.ts
import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import {
  followUser,
  unfollowUser,
  isFollowingUser,
  getUserFollowers,
  getUserFollowing,
} from '../../../../lib/follows.js'
import { emitNotification } from '../../../../lib/notifications.js'
import { getUserByUsername } from '../../../../lib/orgs.js'
import { supabase as adminDb } from '../../../../lib/supabase.js'

function getSessionUser(request: Request): Promise<{ id: string } | null> {
  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const publishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY ?? ''
  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('cookie') ?? '')
      },
      setAll() {},
    },
  })
  return supabase.auth
    .getUser()
    .then(r => (r.data.user ? { id: r.data.user.id } : null))
    .catch(() => null)
}

function requireUser(request: Request): Promise<{ id: string }> {
  return getSessionUser(request).then(u => {
    if (!u) throw new Error('Unauthorized')
    return u
  })
}

async function getUsername(request: Request): Promise<string | null> {
  const u = await getSessionUser(request)
  return u?.id ?? null
}

export const POST: APIRoute = async ({ params, request }) => {
  const { username } = params
  if (!username) return new Response('Bad request', { status: 400 })

  let currentUser: { id: string }
  try {
    currentUser = await requireUser(request)
  } catch {
    return new Response(JSON.stringify({ error: 'Login to follow users.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const targetUser = await getUserByUsername(username)
  if (!targetUser) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (targetUser.id === currentUser.id) {
    return new Response(JSON.stringify({ error: 'Cannot follow yourself.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const alreadyFollowing = await isFollowingUser(currentUser.id, targetUser.id)
  if (alreadyFollowing) return new Response(null, { status: 204 })

  try {
    await followUser(currentUser.id, targetUser.id)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Get current user's username for notification payload
  const { data: userMeta } = await adminDb.auth.admin.getUserById(currentUser.id)
  const followerUsername =
    userMeta.user?.raw_user_meta_data?.user_name ??
    userMeta.user?.raw_user_meta_data?.full_name ??
    'Someone'

  emitNotification(targetUser.id, 'new_follower', {
    followerId: currentUser.id,
    followerUsername,
  }).catch(console.error)

  return new Response(null, { status: 201 })
}

export const DELETE: APIRoute = async ({ params, request }) => {
  const { username } = params
  if (!username) return new Response('Bad request', { status: 400 })

  let currentUser: { id: string }
  try {
    currentUser = await requireUser(request)
  } catch {
    return new Response(JSON.stringify({ error: 'Login required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const targetUser = await getUserByUsername(username)
  if (!targetUser) return new Response(null, { status: 204 }) // idempotent

  try {
    await unfollowUser(currentUser.id, targetUser.id)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(null, { status: 204 })
}

export const GET: APIRoute = async ({ params, request }) => {
  const { username } = params
  if (!username) return new Response('Bad request', { status: 400 })

  const url = new URL(request.url)
  const tab = url.searchParams.get('tab') ?? 'followers'
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  const targetUser = await getUserByUsername(username)
  if (!targetUser) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    if (tab === 'following') {
      const { users, total } = await getUserFollowing(targetUser.id, limit, offset)
      return new Response(JSON.stringify({ users, total }), {
        headers: { 'Content-Type': 'application/json' },
      })
    } else {
      const { users, total } = await getUserFollowers(targetUser.id, limit, offset)
      return new Response(JSON.stringify({ users, total }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd /c/Users/justi/dev/lectern && npx vitest run src/pages/api/users/[username]/follow.test.ts
```
Expected: PASS

- [ ] **Step 3: Write minimal org follow API**

**Files:**
- Create: `src/pages/api/orgs/[slug]/follow.ts`

```typescript
// src/pages/api/orgs/[slug]/follow.ts
import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import {
  followOrg,
  unfollowOrg,
  getOrgFollowers,
} from '../../../../lib/follows.js'
import { emitNotification } from '../../../../lib/notifications.js'
import { getOrgBySlug } from '../../../../lib/orgs.js'
import { supabase as adminDb } from '../../../../lib/supabase.js'

function requireUser(request: Request): Promise<{ id: string }> {
  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const publishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY ?? ''
  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('cookie') ?? '')
      },
      setAll() {},
    },
  })
  return supabase.auth
    .getUser()
    .then(r => {
      if (!r.data.user) throw new Error('Unauthorized')
      return { id: r.data.user.id }
    })
    .catch(() => {
      throw new Error('Unauthorized')
    })
}

export const POST: APIRoute = async ({ params, request }) => {
  const { slug } = params
  if (!slug) return new Response('Bad request', { status: 400 })

  let currentUser: { id: string }
  try {
    currentUser = await requireUser(request)
  } catch {
    return new Response(JSON.stringify({ error: 'Login to follow orgs.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const org = await getOrgBySlug(slug)
  if (!org) {
    return new Response(JSON.stringify({ error: 'Org not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await followOrg(currentUser.id, org.id)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Get follower username
  const { data: userMeta } = await adminDb.auth.admin.getUserById(currentUser.id)
  const followerUsername =
    userMeta.user?.raw_user_meta_data?.user_name ??
    userMeta.user?.raw_user_meta_data?.full_name ??
    'Someone'

  // Notify all org owners
  const { data: owners } = await adminDb
    .from('org_members')
    .select('user_id')
    .eq('org_id', org.id)
    .in('role', ['owner', 'admin'])

  const ownerIds = (owners ?? []).map((o: any) => o.user_id)
  if (ownerIds.length > 0) {
    emitNotification(ownerIds, 'new_org_follower', {
      followerId: currentUser.id,
      followerUsername,
      orgSlug: slug,
    }).catch(console.error)
  }

  return new Response(null, { status: 201 })
}

export const DELETE: APIRoute = async ({ params, request }) => {
  const { slug } = params
  if (!slug) return new Response('Bad request', { status: 400 })

  let currentUser: { id: string }
  try {
    currentUser = await requireUser(request)
  } catch {
    return new Response(JSON.stringify({ error: 'Login required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const org = await getOrgBySlug(slug)
  if (!org) return new Response(null, { status: 204 })

  try {
    await unfollowOrg(currentUser.id, org.id)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(null, { status: 204 })
}

export const GET: APIRoute = async ({ params, request }) => {
  const { slug } = params
  if (!slug) return new Response('Bad request', { status: 400 })

  const org = await getOrgBySlug(slug)
  if (!org) {
    return new Response(JSON.stringify({ error: 'Org not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(request.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  try {
    const { users, total } = await getOrgFollowers(org.id, limit, offset)
    return new Response(JSON.stringify({ users, total }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/users/[username]/follow.ts src/pages/api/orgs/[slug]/follow.ts src/pages/api/users/[username]/follow.test.ts
git commit -m "feat: add user/org follow API routes"
```

---

## Chunk 4: Notifications API Routes

**Files touched:**
- Create: `src/pages/api/notifications/index.ts`
- Create: `src/pages/api/notifications/[id]/read.ts`
- Create: `src/pages/api/notifications/index.test.ts`

---

### Task 1: Write failing tests for notifications API

**Files:**
- Create: `src/pages/api/notifications/index.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/pages/api/notifications/index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/notifications.js', () => ({
  getNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: vi.fn() },
    parseCookieHeader: vi.fn(() => []),
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/notifications', () => {
  it('returns 401 when not logged in', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    vi.mocked(createServerClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as any)

    const { GET } = await import('./index.js')
    const response = await GET({
      request: new Request('http://localhost/api/notifications'),
    } as any)

    expect(response.status).toBe(401)
  })

  it('returns notifications with total and unreadCount', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    vi.mocked(createServerClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    } as any)

    const { getNotifications } = await import('../../../lib/notifications.js')
    vi.mocked(getNotifications).mockResolvedValue({
      notifications: [
        { id: 'n1', userId: 'u1', type: 'new_follower', payload: { followerUsername: 'alice' }, read: false, createdAt: '2024-01-01T00:00:00Z' },
      ],
      total: 1,
      unreadCount: 5,
    })

    const { GET } = await import('./index.js')
    const response = await GET({
      request: new Request('http://localhost/api/notifications'),
    } as any)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.total).toBe(1)
    expect(body.unreadCount).toBe(5)
    expect(body.notifications[0].type).toBe('new_follower')
  })

  it('passes unreadOnly filter to getNotifications', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    vi.mocked(createServerClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    } as any)

    const { getNotifications } = await import('../../../lib/notifications.js')
    vi.mocked(getNotifications).mockResolvedValue({ notifications: [], total: 0, unreadCount: 0 })

    const { GET } = await import('./index.js')
    await GET({
      request: new Request('http://localhost/api/notifications?unread=true'),
    } as any)

    expect(getNotifications).toHaveBeenCalledWith('u1', expect.objectContaining({ unreadOnly: true }))
  })
})

describe('POST /api/notifications', () => {
  it('returns 401 when not logged in', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    vi.mocked(createServerClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as any)

    const { POST } = await import('./index.js')
    const response = await POST({
      request: new Request('http://localhost/api/notifications', { method: 'POST' }),
    } as any)

    expect(response.status).toBe(401)
  })

  it('returns 204 on success', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    vi.mocked(createServerClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    } as any)

    const { markAllNotificationsRead } = await import('../../../lib/notifications.js')
    vi.mocked(markAllNotificationsRead).mockResolvedValue(undefined)

    const { POST } = await import('./index.js')
    const response = await POST({
      request: new Request('http://localhost/api/notifications', { method: 'POST' }),
    } as any)

    expect(response.status).toBe(204)
    expect(markAllNotificationsRead).toHaveBeenCalledWith('u1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /c/Users/justi/dev/lectern && npx vitest run src/pages/api/notifications/index.test.ts
```
Expected: FAIL — module not found

---

### Task 2: Write notifications API implementation

**Files:**
- Create: `src/pages/api/notifications/index.ts`
- Create: `src/pages/api/notifications/[id]/read.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/pages/api/notifications/index.ts
import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getNotifications, markAllNotificationsRead } from '../../../lib/notifications.js'

function requireUser(request: Request): Promise<string> {
  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const publishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY ?? ''
  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('cookie') ?? '')
      },
      setAll() {},
    },
  })
  return supabase.auth
    .getUser()
    .then(r => {
      if (!r.data.user) throw new Error('Unauthorized')
      return r.data.user.id
    })
    .catch(() => {
      throw new Error('Unauthorized')
    })
}

export const GET: APIRoute = async ({ request }) => {
  let userId: string
  try {
    userId = await requireUser(request)
  } catch {
    return new Response(JSON.stringify({ error: 'Login required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(request.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')
  const unreadOnly = url.searchParams.get('unread') === 'true'

  try {
    const result = await getNotifications(userId, { limit, offset, unreadOnly })
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const POST: APIRoute = async ({ request }) => {
  let userId: string
  try {
    userId = await requireUser(request)
  } catch {
    return new Response(JSON.stringify({ error: 'Login required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await markAllNotificationsRead(userId)
    return new Response(null, { status: 204 })
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
```

```typescript
// src/pages/api/notifications/[id]/read.ts
import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { markNotificationRead } from '../../../../../lib/notifications.js'

function requireUser(request: Request): Promise<string> {
  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const publishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY ?? ''
  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('cookie') ?? '')
      },
      setAll() {},
    },
  })
  return supabase.auth
    .getUser()
    .then(r => {
      if (!r.data.user) throw new Error('Unauthorized')
      return r.data.user.id
    })
    .catch(() => {
      throw new Error('Unauthorized')
    })
}

export const POST: APIRoute = async ({ params, request }) => {
  const { id } = params
  if (!id) {
    return new Response('Bad request', { status: 400 })
  }

  let userId: string
  try {
    userId = await requireUser(request)
  } catch {
    return new Response(JSON.stringify({ error: 'Login required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const updated = await markNotificationRead(userId, id)
    return new Response(null, { status: updated ? 204 : 404 })
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd /c/Users/justi/dev/lectern && npx vitest run src/pages/api/notifications/index.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/notifications/index.ts src/pages/api/notifications/[id]/read.ts src/pages/api/notifications/index.test.ts
git commit -m "feat: add notifications API routes"
```

---

## Chunk 5: Comments API Routes

**Files touched:**
- Create: `src/pages/api/packages/[name]/comments/index.ts`
- Create: `src/pages/api/packages/[name]/comments/[id].ts`
- Create: `src/pages/api/packages/[name]/comments/index.test.ts`

Note: The DELETE route for `/api/packages/:name/comments/:id` is in a separate file `[id].ts` because Astro file-based routing maps each path segment to a separate `params` key. In `src/pages/api/packages/[name]/comments/[id].ts`, Astro will give us `params = { name: 'pkg', id: 'comment-id' }`.

---

### Task 1: Write failing tests for comments API

**Files:**
- Create: `src/pages/api/packages/[name]/comments/index.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/pages/api/packages/[name]/comments/index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../../lib/db.js', () => ({
  getPackageComments: vi.fn(),
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  getPackageOwner: vi.fn(),
}))

vi.mock('../../../../../lib/notifications.js', () => ({
  emitNotification: vi.fn(),
  emitNotificationBatch: vi.fn(),
}))

vi.mock('../../../../../lib/supabase.js', () => ({
  supabase: { auth: { admin: { getUserById: vi.fn() } } },
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: vi.fn() },
  })),
  parseCookieHeader: vi.fn(() => []),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/packages/[name]/comments', () => {
  it('returns paginated comments list', async () => {
    const { getPackageComments } = await import('../../../../../lib/db.js')
    vi.mocked(getPackageComments).mockResolvedValue({
      comments: [
        {
          id: 'c1',
          packageName: 'my-pkg',
          userId: 'u1',
          username: 'alice',
          avatarUrl: null,
          body: 'Great package!',
          parentId: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      total: 1,
    })

    const { GET } = await import('./index.js')
    const url = new URL('http://localhost/api/packages/my-pkg/comments?limit=20&offset=0')
    const response = await GET({
      params: { name: 'my-pkg' },
      request: new Request(url),
    } as any)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.comments).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.comments[0].body).toBe('Great package!')
  })
})

describe('POST /api/packages/[name]/comments', () => {
  it('returns 401 when not logged in', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    vi.mocked(createServerClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as any)

    const { POST } = await import('./index.js')
    const response = await POST({
      params: { name: 'my-pkg' },
      request: new Request('http://localhost/api/packages/my-pkg/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Hello' }),
      }),
    } as any)

    expect(response.status).toBe(401)
  })

  it('returns 400 for empty body', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    vi.mocked(createServerClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    } as any)

    const { POST } = await import('./index.js')
    const response = await POST({
      params: { name: 'my-pkg' },
      request: new Request('http://localhost/api/packages/my-pkg/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: '   ' }),
      }),
    } as any)

    expect(response.status).toBe(400)
  })

  it('returns 201 and emits notification on success', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    vi.mocked(createServerClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'commenter-uuid' } } }) },
    } as any)

    const { getPackageOwner } = await import('../../../../../lib/db.js')
    vi.mocked(getPackageOwner).mockResolvedValue('owner-uuid')

    const { createComment } = await import('../../../../../lib/db.js')
    vi.mocked(createComment).mockResolvedValue({
      id: 'c1',
      packageName: 'my-pkg',
      userId: 'commenter-uuid',
      username: 'alice',
      avatarUrl: null,
      body: 'Great package!',
      parentId: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })

    const { emitNotification } = await import('../../../../../lib/notifications.js')

    const { POST } = await import('./index.js')
    const response = await POST({
      params: { name: 'my-pkg' },
      request: new Request('http://localhost/api/packages/my-pkg/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Great package!' }),
      }),
    } as any)

    expect(response.status).toBe(201)
    expect(emitNotification).toHaveBeenCalledWith(
      'owner-uuid',
      'package_commented',
      expect.objectContaining({ commenterId: 'commenter-uuid', packageName: 'my-pkg' })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /c/Users/justi/dev/lectern && npx vitest run src/pages/api/packages/[name]/comments/index.test.ts
```
Expected: FAIL — module not found

---

### Task 2: Write comments API implementation

**Files:**
- Create: `src/pages/api/packages/[name]/comments/index.ts`
- Create: `src/pages/api/packages/[name]/comments/[id].ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/pages/api/packages/[name]/comments/index.ts
import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import {
  getPackageComments,
  createComment,
  getPackageOwner,
} from '../../../../../lib/db.js'
import { emitNotification, emitNotificationBatch } from '../../../../../lib/notifications.js'
import { supabase as adminDb } from '../../../../../lib/supabase.js'

function requireUser(request: Request): Promise<{ id: string }> {
  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const publishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY ?? ''
  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('cookie') ?? '')
      },
      setAll() {},
    },
  })
  return supabase.auth
    .getUser()
    .then(r => {
      if (!r.data.user) throw new Error('Unauthorized')
      return { id: r.data.user.id }
    })
    .catch(() => {
      throw new Error('Unauthorized')
    })
}

export const GET: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) {
    return new Response('Bad request', { status: 400 })
  }

  const url = new URL(request.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  try {
    const { comments, total } = await getPackageComments(name, limit, offset)
    return new Response(JSON.stringify({ comments, total }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const POST: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) {
    return new Response('Bad request', { status: 400 })
  }

  let user: { id: string }
  try {
    user = await requireUser(request)
  } catch {
    return new Response(JSON.stringify({ error: 'Login to comment.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { body?: string; parentId?: string }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const commentBody = (body.body ?? '').trim()
  if (!commentBody || commentBody.length > 10000) {
    return new Response(
      JSON.stringify({ error: 'Comment body required, max 10000 characters.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const ownerId = await getPackageOwner(name)
  if (!ownerId) {
    return new Response(JSON.stringify({ error: 'Package not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const comment = await createComment(name, user.id, commentBody, body.parentId)

    // Get commenter username
    const { data: userMeta } = await adminDb.auth.admin.getUserById(user.id)
    const commenterUsername =
      userMeta.user?.raw_user_meta_data?.user_name ??
      userMeta.user?.raw_user_meta_data?.full_name ??
      'Someone'

    const bodyPreview =
      commentBody.length > 100 ? commentBody.slice(0, 100) + '...' : commentBody

    // Notify owner if commenter is not the owner
    if (ownerId !== user.id) {
      emitNotification(ownerId, 'package_commented', {
        commenterId: user.id,
        commenterUsername,
        packageName: name,
        commentId: comment.id,
        bodyPreview,
      }).catch(console.error)
    }

    // Notify all previous commenters (except owner and new commenter)
    const { data: previousCommenters } = await adminDb
      .from('package_comments')
      .select('user_id')
      .eq('package_name', name)
      .eq('deleted', false)
      .neq('user_id', user.id)
      .neq('user_id', ownerId)

    const uniqueCommenterIds = [...new Set((previousCommenters ?? []).map((c: any) => c.user_id))]
    if (uniqueCommenterIds.length > 0) {
      emitNotificationBatch(uniqueCommenterIds, 'package_commented', {
        commenterId: user.id,
        commenterUsername,
        packageName: name,
        commentId: comment.id,
        bodyPreview,
      }).catch(console.error)
    }

    return new Response(JSON.stringify(comment), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
```

```typescript
// src/pages/api/packages/[name]/comments/[id].ts
import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { deleteComment } from '../../../../../../lib/db.js'

function requireUser(request: Request): Promise<{ id: string }> {
  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const publishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY ?? ''
  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('cookie') ?? '')
      },
      setAll() {},
    },
  })
  return supabase.auth
    .getUser()
    .then(r => {
      if (!r.data.user) throw new Error('Unauthorized')
      return { id: r.data.user.id }
    })
    .catch(() => {
      throw new Error('Unauthorized')
    })
}

export const DELETE: APIRoute = async ({ params, request }) => {
  const { name, id } = params as { name?: string; id?: string }
  if (!name || !id) {
    return new Response('Bad request', { status: 400 })
  }

  let user: { id: string }
  try {
    user = await requireUser(request)
  } catch {
    return new Response(JSON.stringify({ error: 'Login required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await deleteComment(id, user.id)
    return new Response(null, { status: 204 })
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd /c/Users/justi/dev/lectern && npx vitest run src/pages/api/packages/[name]/comments/index.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/packages/[name]/comments/index.ts src/pages/api/packages/[name]/comments/[id].ts src/pages/api/packages/[name]/comments/index.test.ts
git commit -m "feat: add package comments API routes"
```

---

## Chunk 6: Notifications Page

**Files touched:**
- Create: `src/pages/notifications.astro`

---

### Task 1: Implement the notifications page

**Files:**
- Create: `src/pages/notifications.astro`

- [ ] **Step 1: Write the page implementation**

This page requires authentication. Uses `createServerClient` for SSR session, redirects to `/login` if not authenticated. Fetches notifications client-side after mount to avoid SSR complexity.

```astro
---
import Base from '../layouts/Base.astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'

const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
const publishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY ?? ''

const supabase = createServerClient(supabaseUrl, publishableKey, {
  cookies: {
    getAll() {
      return parseCookieHeader(Astro.request.headers.get('cookie') ?? '')
    },
    setAll() {},
  },
})

const { data: { session } } = await supabase.auth.getSession()
if (!session) return Astro.redirect('/login')
const userId = session.user.id
---

<Base title="Notifications" description="Your notification feed">
  <style>
    .notifications-page { max-width: 640px; margin: 0 auto; padding: 2rem 1rem; }
    .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem; }
    .page-title { font-family: var(--font-mono); font-size: 1.5rem; font-weight: 600; }
    .mark-all-btn {
      font-family: var(--font-mono); font-size: 0.8rem; padding: 0.4rem 0.875rem;
      border: 1px solid var(--border); background: var(--surface); border-radius: 6px;
      cursor: pointer; color: var(--muted); transition: color 0.15s, border-color 0.15s;
    }
    .mark-all-btn:hover { color: var(--text); border-color: var(--accent); }
    .mark-all-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .unread-badge {
      font-family: var(--font-mono); font-size: 0.75rem; padding: 0.15rem 0.5rem;
      border-radius: 999px; background: var(--accent); color: white; margin-left: 0.5rem;
    }
    .day-group { margin-bottom: 2rem; }
    .day-label {
      font-family: var(--font-mono); font-size: 0.7rem; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--muted); margin-bottom: 0.75rem; padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    .notification-item {
      display: flex; align-items: flex-start; gap: 0.875rem; padding: 0.875rem;
      border-radius: 8px; border-left: 3px solid transparent; transition: background 0.15s;
      cursor: pointer; text-decoration: none; color: var(--text);
    }
    .notification-item:hover { background: var(--surface); }
    .notification-item.unread { background: color-mix(in srgb, var(--accent) 5%, transparent); border-left-color: var(--accent); }
    .notif-icon { width: 32px; height: 32px; border-radius: 50%; background: var(--surface); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .notif-content { flex: 1; min-width: 0; }
    .notif-text { font-size: 0.875rem; line-height: 1.5; }
    .notif-text strong { font-weight: 600; }
    .notif-time { font-family: var(--font-mono); font-size: 0.75rem; color: var(--muted); margin-top: 0.25rem; }
    .empty-state { text-align: center; padding: 4rem 1rem; color: var(--muted); }
    .empty-icon { width: 64px; height: 64px; margin: 0 auto 1rem; opacity: 0.3; }
    .empty-text { font-family: var(--font-mono); font-size: 0.9rem; max-width: 300px; margin: 0 auto; line-height: 1.6; }
    .loading { font-family: var(--font-mono); font-size: 0.875rem; color: var(--muted); padding: 2rem; text-align: center; }
  </style>

  <div class="notifications-page">
    <div class="page-header">
      <h1 class="page-title">
        Notifications
        <span id="unread-badge" class="unread-badge" style="display:none"></span>
      </h1>
      <button id="mark-all-btn" class="mark-all-btn" disabled>Mark all as read</button>
    </div>

    <div id="loading" class="loading">Loading...</div>
    <div id="empty-state" class="empty-state" style="display:none">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      <p class="empty-text">No notifications yet. Follow users and orgs to see activity here.</p>
    </div>
    <div id="notifications-list"></div>
  </div>

  <script define:vars={{ userId }}>
    const NOTIF_ICONS = {
      new_follower: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8l2 2 4-4"/></svg>',
      new_org_follower: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      package_starred: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
      package_commented: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      new_version: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
      comment_replied: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
      package_deprecated: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    };

    const NOTIF_DESCRIPTIONS = {
      new_follower: (p) => `<strong>${p.followerUsername}</strong> started following you`,
      new_org_follower: (p) => `<strong>${p.followerUsername}</strong> started following <strong>${p.orgSlug}</strong>`,
      package_starred: (p) => `<strong>${p.starrerUsername}</strong> starred <strong>${p.packageName}</strong>`,
      package_commented: (p) => `<strong>${p.commenterUsername}</strong> commented on <strong>${p.packageName}</strong>`,
      new_version: (p) => `New version ${p.version} of <strong>${p.packageName}</strong> was published`,
      comment_replied: (p) => `<strong>${p.replierUsername}</strong> replied on <strong>${p.packageName}</strong>`,
      package_deprecated: (p) => `<strong>${p.deprecatorUsername}</strong> deprecated <strong>${p.packageName}</strong>`,
    };

    const NOTIF_HREFS = {
      new_follower: (p) => `/${p.followerUsername}`,
      new_org_follower: (p) => `/orgs/${p.orgSlug}`,
      package_starred: (p) => `/packages/${p.packageName}`,
      package_commented: (p) => `/packages/${p.packageName}#comments`,
      new_version: (p) => `/packages/${p.packageName}`,
      comment_replied: (p) => `/packages/${p.packageName}#comments`,
      package_deprecated: (p) => `/packages/${p.packageName}`,
    };

    function relativeTime(dateStr) {
      const diff = Date.now() - new Date(dateStr).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      if (days < 7) return `${days}d ago`;
      return new Date(dateStr).toLocaleDateString();
    }

    function groupByDay(notifications) {
      const now = new Date();
      const today = now.toDateString();
      const yesterday = new Date(now - 86400000).toDateString();
      const thisWeek = new Date(now - 7 * 86400000);

      const groups = {};
      for (const n of notifications) {
        const d = new Date(n.createdAt).toDateString();
        let label;
        if (d === today) label = 'Today';
        else if (d === yesterday) label = 'Yesterday';
        else if (new Date(d) >= thisWeek) label = 'Earlier this week';
        else label = 'Older';
        if (!groups[label]) groups[label] = [];
        groups[label].push(n);
      }
      return groups;
    }

    async function loadNotifications() {
      const res = await fetch('/api/notifications?limit=50');
      if (!res.ok) return;
      const data = await res.json();
      renderNotifications(data.notifications, data.unreadCount);
    }

    function renderNotifications(notifications, unreadCount) {
      document.getElementById('loading').style.display = 'none';

      if (unreadCount > 0) {
        const badge = document.getElementById('unread-badge');
        badge.textContent = unreadCount;
        badge.style.display = 'inline';
        document.getElementById('mark-all-btn').disabled = false;
      }

      if (notifications.length === 0) {
        document.getElementById('empty-state').style.display = 'block';
        return;
      }

      const list = document.getElementById('notifications-list');
      const groups = groupByDay(notifications);

      for (const [label, items] of Object.entries(groups)) {
        const group = document.createElement('div');
        group.className = 'day-group';
        group.innerHTML = `<div class="day-label">${label}</div>`;

        for (const n of items) {
          const href = NOTIF_HREFS[n.type]?.(n.payload) ?? '#';
          const desc = NOTIF_DESCRIPTIONS[n.type]?.(n.payload) ?? JSON.stringify(n.payload);
          const icon = NOTIF_ICONS[n.type] ?? '';

          const item = document.createElement('a');
          item.href = href;
          item.className = `notification-item${n.read ? '' : ' unread'}`;
          item.dataset.id = n.id;
          item.dataset.read = n.read;
          item.innerHTML = `
            <div class="notif-icon">${icon}</div>
            <div class="notif-content">
              <div class="notif-text">${desc}</div>
              <div class="notif-time">${relativeTime(n.createdAt)}</div>
            </div>
          `;
          item.addEventListener('click', async (e) => {
            if (!n.read) {
              await fetch(`/api/notifications/${n.id}/read`, { method: 'POST' });
            }
          });
          group.appendChild(item);
        }

        list.appendChild(group);
      }
    }

    document.getElementById('mark-all-btn').addEventListener('click', async () => {
      const btn = document.getElementById('mark-all-btn');
      btn.disabled = true;
      await fetch('/api/notifications', { method: 'POST' });
      document.getElementById('unread-badge').style.display = 'none';
      document.querySelectorAll('.notification-item.unread').forEach(el => {
        el.classList.remove('unread');
      });
    });

    loadNotifications();
  </script>
</Base>
```

- [ ] **Step 2: Verify page renders (manual test)**

Run:
```bash
cd /c/Users/justi/dev/lectern && npm run dev
# Visit http://localhost:4321/notifications
# Should redirect to /login if not authenticated
# Should show notifications list if authenticated
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/notifications.astro
git commit -m "feat: add notifications feed page"
```

---

## Chunk 7: Package Page Comments Section

**Files touched:**
- Modify: `src/pages/packages/[name].astro` (add comments section)
- Modify: `src/pages/[slug]/index.astro` (add Followers/Following tabs)

Note: These are page modifications rather than API routes, so they don't follow TDD (Astro pages are tested manually). For each, describe the changes in detail.

---

### Task 1: Add comments section to package page

**Files:**
- Modify: `src/pages/packages/[name].astro`

- [ ] **Step 1: Add the comments section**

After the changelog section in `src/pages/packages/[name].astro`, add:

1. A `<section id="comments">` with heading "Comments" + count badge
2. A comment form (authenticated users only): textarea + "Post comment" button
3. A comment list: flat list of top-level comments
4. Each comment: avatar, username link, timestamp, body, delete button (if author)
5. "Discuss on GitHub" link if package has `repository` URL

The section should use client-side fetch:
- `GET /api/packages/${name}/comments` on mount
- `POST /api/packages/${name}/comments` on submit
- `DELETE /api/packages/${name}/comments/${commentId}` for delete

Example implementation to add after the changelog section (approximately line 250+ of the existing file):

```astro
<!-- Comments Section -->
<section id="comments" class="section">
  <div class="section-heading">
    Comments
    <span id="comment-count-badge" class="badge" style="margin-left:0.5rem"></span>
  </div>

  <!-- Comment form (authenticated only) -->
  <div id="comment-form-wrapper" style="display:none; margin-bottom:1.5rem;">
    <form id="comment-form">
      <textarea
        id="comment-body"
        name="body"
        rows="3"
        placeholder="Leave a comment..."
        style="width:100%; padding:0.75rem; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text); font-family:var(--font-mono); font-size:0.875rem; resize:vertical; margin-bottom:0.5rem;"
      ></textarea>
      <div style="display:flex; align-items:center; gap:0.5rem;">
        <button
          type="submit"
          id="submit-comment-btn"
          disabled
          style="font-family:var(--font-mono); font-size:0.8rem; padding:0.4rem 1rem; border:1px solid var(--accent); background:var(--accent); color:white; border-radius:6px; cursor:pointer;"
        >Post comment</button>
        <span id="comment-error" style="font-family:var(--font-mono); font-size:0.75rem; color:var(--accent); display:none;"></span>
      </div>
    </form>
  </div>

  <!-- Comment list -->
  <div id="comment-list"></div>
  <div id="comment-empty" style="display:none; font-family:var(--font-mono); font-size:0.875rem; color:var(--muted); padding:1.5rem 0; text-align:center;">No comments yet.</div>
  <div id="comment-github-link" style="margin-top:1rem;">
    <a id="github-link" href="#" target="_blank" rel="noopener" style="font-family:var(--font-mono); font-size:0.8rem; color:var(--muted);">
      Discuss on GitHub
    </a>
  </div>
</section>
```

Add client-side JavaScript:

```javascript
// In a <script> tag within the Astro component
const packageName = name; // from Astro params
const session = { user: userId }; // passed from SSR

// Show/hide form based on auth
if (session?.user) {
  document.getElementById('comment-form-wrapper').style.display = 'block';
}

// Load comments
async function loadComments() {
  const res = await fetch(`/api/packages/${packageName}/comments`);
  if (!res.ok) return;
  const { comments, total } = await res.json();
  renderComments(comments, total);
}

function renderComments(comments, total) {
  const countBadge = document.getElementById('comment-count-badge');
  countBadge.textContent = total;

  const list = document.getElementById('comment-list');
  const empty = document.getElementById('comment-empty');

  if (comments.length === 0) {
    list.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = comments.map(c => `
    <div class="comment-item" style="display:flex; gap:0.75rem; padding:1rem 0; border-bottom:1px solid var(--border);">
      <div class="comment-avatar" style="width:32px; height:32px; border-radius:50%; background:var(--surface); flex-shrink:0; overflow:hidden;">
        ${c.avatarUrl ? `<img src="${c.avatarUrl}" width="32" height="32" style="object-fit:cover;">` : `<div style="width:32px; height:32px; display:flex; align-items:center; justify-content:center; font-family:var(--font-mono); font-size:0.875rem; color:var(--muted);">${c.username.charAt(0).toUpperCase()}</div>`}
      </div>
      <div style="flex:1; min-width:0;">
        <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.25rem;">
          <a href="/${c.username}" style="font-family:var(--font-mono); font-size:0.875rem; font-weight:500; color:var(--text); text-decoration:none;">${c.username}</a>
          <span style="font-family:var(--font-mono); font-size:0.75rem; color:var(--muted);">${new Date(c.createdAt).toLocaleDateString()}</span>
          ${c.userId === session?.user?.id ? `<button class="delete-comment-btn" data-id="${c.id}" style="margin-left:auto; font-family:var(--font-mono); font-size:0.75rem; color:var(--muted); background:none; border:none; cursor:pointer; padding:0;">Delete</button>` : ''}
        </div>
        <p style="font-family:var(--font-mono); font-size:0.875rem; line-height:1.6; color:var(--text); white-space:pre-wrap;">${c.body}</p>
      </div>
    </div>
  `).join('');

  // Attach delete handlers
  list.querySelectorAll('.delete-comment-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm('Delete this comment?')) return;
      const res = await fetch(`/api/packages/${packageName}/comments/${id}`, { method: 'DELETE' });
      if (res.status === 204) loadComments();
    });
  });
}

// Comment form submission
const form = document.getElementById('comment-form');
const textarea = document.getElementById('comment-body');
const submitBtn = document.getElementById('submit-comment-btn');
const errorSpan = document.getElementById('comment-error');

textarea.addEventListener('input', () => {
  submitBtn.disabled = textarea.value.trim().length === 0;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  errorSpan.style.display = 'none';

  const res = await fetch(`/api/packages/${packageName}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: textarea.value.trim() }),
  });

  if (res.status === 201) {
    textarea.value = '';
    submitBtn.disabled = true;
    loadComments();
  } else if (res.status === 401) {
    errorSpan.textContent = 'Login to comment.';
    errorSpan.style.display = 'inline';
  } else {
    const data = await res.json();
    errorSpan.textContent = data.error ?? 'Failed to post comment.';
    errorSpan.style.display = 'inline';
  }
  submitBtn.disabled = false;
});

loadComments();
```

- [ ] **Step 2: Test the page**

Run dev server and visit `/packages/test-pkg`. Verify:
- Comments section appears below changelog
- Comment form appears when logged in, hidden when logged out
- Comments list renders correctly
- Post comment works
- Delete comment works (for own comments)

- [ ] **Step 3: Commit**

```bash
git add src/pages/packages/[name].astro
git commit -m "feat: add comments section to package page"
```

---

### Task 2: Add Followers/Following tabs to user/org profile

**Files:**
- Modify: `src/pages/[slug]/index.astro`

- [ ] **Step 1: Add the tabs and tab content**

In `src/pages/[slug]/index.astro`, add to the tabs section:

1. Add `Followers` and `Following` buttons to the tab bar (for users) or just `Followers` (for orgs)
2. Add corresponding tab content panels
3. Add client-side fetch to load followers/following data
4. Add follow/unfollow toggle buttons on each card (only when viewing someone else's profile)

In the tab bar, add:
```astro
<button class="tab" data-tab="followers">Followers</button>
<button class="tab" data-tab="following">Following</button>
```

In the tab content area, add:
```astro
<div id="tab-followers" class="tab-content"></div>
<div id="tab-following" class="tab-content"></div>
```

Add the tab switcher to the existing `<script>` block and add:

```javascript
// Follow state tracking
let currentUserId = null;
let profileOwnerId = isOrg ? null : user.id; // from SSR
let isOwnProfile = false;

async function checkAuth() {
  const res = await fetch('/api/auth/session'); // or check session from SSR
  const data = await res.json();
  currentUserId = data.user?.id ?? null;
  isOwnProfile = currentUserId === profileOwnerId;
}

async function loadFollowers() {
  const tab = document.getElementById('tab-followers');
  const res = await fetch(`/api/users/${slug}/follow?tab=followers&limit=20&offset=0`);
  const data = await res.json();
  renderUserList(tab, data.users, data.total, 'followers');
}

async function loadFollowing() {
  const tab = document.getElementById('tab-following');
  const res = await fetch(`/api/users/${slug}/follow?tab=following&limit=20&offset=0`);
  const data = await res.json();
  renderUserList(tab, data.users, data.total, 'following');
}

function renderUserList(container, users, total, tab) {
  if (users.length === 0) {
    container.innerHTML = `<p class="empty">No ${tab} yet.</p>`;
    return;
  }
  container.innerHTML = users.map(u => `
    <div class="user-card" style="display:flex; align-items:center; gap:0.75rem; padding:0.75rem; border-bottom:1px solid var(--border);">
      <a href="/${u.username}" style="display:flex; align-items:center; gap:0.75rem; text-decoration:none; color:var(--text); flex:1;">
        <div style="width:36px; height:36px; border-radius:50%; background:var(--surface); overflow:hidden; flex-shrink:0;">
          ${u.avatarUrl ? `<img src="${u.avatarUrl}" width="36" height="36" style="object-fit:cover;">` : `<div style="width:36px; height:36px; display:flex; align-items:center; justify-content:center; font-family:var(--font-mono); font-size:0.875rem; color:var(--muted);">${u.username.charAt(0).toUpperCase()}</div>`}
        </div>
        <span style="font-family:var(--font-mono); font-size:0.875rem;">${u.username}</span>
      </a>
      ${!isOwnProfile && currentUserId ? `
        <button class="follow-toggle-btn" data-username="${u.username}" data-following="${u.userId}" style="font-family:var(--font-mono); font-size:0.75rem; padding:0.3rem 0.75rem; border:1px solid var(--border); border-radius:6px; background:var(--surface); cursor:pointer; color:var(--muted);">
          Following
        </button>
      ` : ''}
    </div>
  `).join('');

  // Attach follow toggle handlers
  container.querySelectorAll('.follow-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const username = btn.dataset.username;
      const isCurrentlyFollowing = btn.textContent.trim() === 'Following';
      const method = isCurrentlyFollowing ? 'DELETE' : 'POST';
      await fetch(`/api/users/${username}/follow`, { method });
      btn.textContent = isCurrentlyFollowing ? 'Follow' : 'Following';
    });
  });
}
```

- [ ] **Step 2: Test the page**

Run dev server and visit `/:username`. Verify:
- Followers tab shows paginated list
- Following tab shows paginated list
- Follow/Unfollow toggle works on each card

- [ ] **Step 3: Commit**

```bash
git add src/pages/[slug]/index.astro
git commit -m "feat: add followers/following tabs to user profile"
```

---

## Chunk 8: Hook Notifications into Existing Actions

**Files touched:**
- Modify: `src/pages/api/packages/[name]/star.ts` — emit `package_starred` notifications
- Modify: `src/pages/api/packages/[name]/deprecate.ts` — emit `package_deprecated` notifications

---

### Task 1: Emit `package_starred` notification on star

**Files:**
- Modify: `src/pages/api/packages/[name]/star.ts`

- [ ] **Step 1: Add notification emit after starring**

After `await starPackage(userId, name)` succeeds, add:

```typescript
// Get starrer username
const { data: userMeta } = await adminDb.auth.admin.getUserById(userId)
const starrerUsername = userMeta.user?.raw_user_meta_data?.user_name
  ?? userMeta.user?.raw_user_meta_data?.full_name
  ?? 'Someone'

// Notify all other starrers (not the starrer themselves)
const { data: otherStarrers } = await adminDb
  .from('package_stars')
  .select('user_id')
  .eq('package_name', name)
  .neq('user_id', userId)

const otherStarrerIds = (otherStarrers ?? []).map((s: any) => s.user_id)
if (otherStarrerIds.length > 0) {
  emitNotificationBatch(otherStarrerIds, 'package_starred', {
    starrerId: userId,
    starrerUsername,
    packageName: name,
  }).catch(console.error)
}
```

Import the new functions at the top of `star.ts`:
```typescript
import { emitNotificationBatch } from '../../../../lib/notifications.js'
```

- [ ] **Step 2: Verify with test**

Run:
```bash
cd /c/Users/justi/dev/lectern && npx vitest run src/pages/api/packages/[name]/star.test.ts
```
Expected: existing tests still pass (no behavior change to star count)

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/packages/[name]/star.ts
git commit -m "feat: emit package_starred notification on star"
```

---

### Task 2: Emit `package_deprecated` notification on deprecate

**Files:**
- Modify: `src/pages/api/packages/[name]/deprecate.ts`

- [ ] **Step 1: Add notification emit after deprecating**

After the deprecation update succeeds, add similar notification dispatch:

```typescript
// Notify all starrers and dependents
const { data: starrers } = await adminDb
  .from('package_stars')
  .select('user_id')
  .eq('package_name', name)

const { data: dependents } = await adminDb
  .from('package_versions')
  .select('dependencies')
  .eq('package_name', name)

const allDeps = dependents ?? []
const dependentUserIds = allDeps
  .map((v: any) => Object.keys(v.dependencies ?? {}))
  .flat()
  .filter(pkg => pkg === name)
  // This is simplified; in practice you'd look up reverse deps

const allNotifyIds = [...new Set([
  ...(starrers ?? []).map((s: any) => s.user_id),
])]

if (allNotifyIds.length > 0) {
  emitNotificationBatch(allNotifyIds, 'package_deprecated', {
    deprecatorId: userId,
    deprecatorUsername,
    packageName: name,
    version,
    message,
  }).catch(console.error)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/api/packages/[name]/deprecate.ts
git commit -m "feat: emit package_deprecated notification on deprecate"
```

---

## Verification

After all chunks are complete:

```bash
# Run all tests
cd /c/Users/justi/dev/lectern
npx vitest run

# Apply migration (fresh environment)
npx supabase db push

# Manual smoke tests:
# /notifications         → redirects to /login when unauthenticated
# /packages/:name        → shows comments section
# /:username             → shows Followers/Following tabs
# POST /api/users/:username/follow → creates follow + notification
# POST /api/packages/:name/comments → creates comment + notification
# GET /api/notifications → returns notifications for authed user
```
