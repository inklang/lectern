# Design: Community Features — Follows, Notifications, Comments

**Date:** 2026-03-25

## Overview

Add three interconnected community features:

1. **Follow system** — users can follow other users and orgs
2. **Notification feed** — in-app activity feed tied to the follow graph
3. **Lite comments** — flat, top-level comments on packages

These three features work together: following drives the notification graph, and notifications surface package activity. Comments allow maintainer-user interaction without the overhead of a full discussion system.

This spec covers v1 only. Email, RSS, and webhooks are deferred to a future phase.

---

## 1. Data Model

### Follow System

```sql
-- Users follow other users
create table user_follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid references auth.users on delete cascade not null,
  following_id uuid references auth.users on delete cascade not null,
  created_at   timestamptz default now(),
  unique (follower_id, following_id)
);

-- Users follow orgs
create table org_follows (
  id          uuid primary key default gen_random_uuid(),
  follower_id uuid references auth.users on delete cascade not null,
  org_id     uuid references orgs on delete cascade not null,
  created_at timestamptz default now(),
  unique (follower_id, org_id)
);
```

### Notifications

```sql
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users on delete cascade not null,
  type       text not null,
  payload    jsonb not null,
  read       boolean default false,
  created_at timestamptz default now()
);

create index notifications_user_created on notifications (user_id, created_at desc);
```

**Notification types and their payloads:**

| Type | Payload fields | Trigger |
|---|---|---|
| `new_follower` | `followerId`, `followerUsername` | User A follows User B |
| `new_org_follower` | `followerId`, `followerUsername`, `orgSlug` | User A follows Org B |
| `package_starred` | `starrerId`, `starrerUsername`, `packageName` | User A stars Package P |
| `package_commented` | `commenterId`, `commenterUsername`, `packageName`, `commentId`, `bodyPreview` | User A comments on Package P |
| `new_version` | `publisherId`, `publisherUsername`, `packageName`, `version` | Publisher releases new version |
| `comment_replied` | `replierId`, `replierUsername`, `packageName`, `commentId`, `parentId`, `bodyPreview` | User A replies to comment on Package P |
| `package_deprecated` | `deprecatorId`, `deprecatorUsername`, `packageName`, `version`, `message` | Publisher deprecates Package P |

`bodyPreview` is the first 100 characters of the comment body, truncated server-side.

### Comments

```sql
create table package_comments (
  id           uuid primary key default gen_random_uuid(),
  package_name text not null,
  user_id      uuid references auth.users on delete cascade not null,
  body         text not null,
  parent_id    uuid references package_comments on delete cascade,  -- null = top-level
  deleted      boolean default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index package_comments_package on package_comments (package_name, created_at asc);
```

`parent_id` is nullable. Only top-level comments (`parent_id IS NULL`) are shown in v1. Replies are stored but not displayed — this enables future threaded comments without a schema change.

---

## 2. RLS Policies

```sql
alter table user_follows enable row level security;
alter table org_follows enable row level security;
alter table notifications enable row level security;
alter table package_comments enable row level security;

-- user_follows: anyone can read; auth users manage their own
create policy "public read user_follows" on user_follows for select using (true);
create policy "users manage own follows" on user_follows
  for all using (auth.uid() = follower_id);

-- org_follows: anyone can read; auth users manage their own
create policy "public read org_follows" on org_follows for select using (true);
create policy "users manage own org follows" on org_follows
  for all using (auth.uid() = follower_id);

-- notifications: users read their own; service role inserts
create policy "users read own notifications" on notifications
  for select using (auth.uid() = user_id);
create policy "service role can insert notifications" on notifications
  for insert with check (true);  -- called from Edge Functions with service role key

-- package_comments: public read non-deleted; authors manage their own
create policy "public read package_comments" on package_comments
  for select using (deleted = false);
create policy "users manage own comments" on package_comments
  for all using (auth.uid() = user_id);
```

---

## 3. API Endpoints

### Follow / Unfollow Users

```
POST   /api/users/:username/follow
DELETE /api/users/:username/follow

GET    /api/users/:username/followers?limit=20&offset=0
GET    /api/users/:username/following?limit=20&offset=0
```

**`POST /api/users/:username/follow`** — Authenticated only.
- If `username` is the current user, return 400.
- If already following, return 204 (idempotent).
- On success, insert `user_follows` row and emit `new_follower` notification to the target user. Return 201.

**`DELETE /api/users/:username/follow`** — Authenticated only.
- Remove `user_follows` row. Return 204 even if row didn't exist.

**`GET /api/users/:username/followers`** — Public.
- Returns paginated list: `{ users: [{ userId, username, avatarUrl }], total }`

**`GET /api/users/:username/following`** — Public.
- Same shape as followers.

### Follow / Unfollow Orgs

```
POST   /api/orgs/:slug/follow
DELETE /api/orgs/:slug/follow

GET    /api/orgs/:slug/followers?limit=20&offset=0
```

**`POST /api/orgs/:slug/follow`** — Authenticated only.
- Resolve slug to org. If not found, return 404.
- Insert `org_follows` row and emit `new_org_follower` notification to the org's owners. Return 201.

**`DELETE /api/orgs/:slug/follow`** — Authenticated only.
- Remove `org_follows` row. Return 204.

**`GET /api/orgs/:slug/followers`** — Public.
- Returns paginated list: `{ users: [{ userId, username, avatarUrl }], total }`

### Notifications

```
GET  /api/notifications?limit=20&offset=0&unread=true|false
POST /api/notifications/:id/read
POST /api/notifications/read-all
```

**`GET /api/notifications`** — Authenticated only.
- Returns `{ notifications: [{ id, type, payload, read, createdAt }], total, unreadCount }`
- Filter by `unread=true` to return only unread. Default: all.
- Ordered by `created_at desc`.
- `total` is the full count matching the filter.

**`POST /api/notifications/:id/read`** — Authenticated only.
- Set `read = true` for the notification if it belongs to the user. Return 204.

**`POST /api/notifications/read-all`** — Authenticated only.
- Set `read = true` for all the user's notifications. Return 204.

### Comments

```
GET    /api/packages/:name/comments?limit=20&offset=0
POST   /api/packages/:name/comments
DELETE /api/packages/:name/comments/:id
```

**`GET /api/packages/:name/comments`** — Public.
- Returns `{ comments: [{ id, userId, username, avatarUrl, body, createdAt, updatedAt }], total }`
- Only top-level comments (`parent_id IS NULL`) in v1.
- `body` is returned as-is. `deleted` comments are excluded by RLS.
- Ordered by `created_at asc`.

**`POST /api/packages/:name/comments`** — Authenticated only.
- Body: `{ body: string, parentId?: string }`
- `body` is required, max 10,000 characters, trimmed.
- If `parentId` is provided, verify it belongs to this package and user has not exceeded nesting (v1: nesting not displayed but stored).
- Insert comment. If the commenter is not the package owner, emit `package_commented` notification to the owner. Return 201 with the comment object.

**`DELETE /api/packages/:name/comments/:id`** — Authenticated only.
- Set `deleted = true` on the comment. RLS ensures only the author can delete.
- Return 204.

---

## 4. Pages

### User Profile — Follow Tabs

`/users/:username`

New tabs: **Followers** | **Following**

- Each tab shows a paginated grid of avatar + username cards.
- If the logged-in user is viewing and is not the profile owner: each card shows a Follow/Unfollow toggle button.
- Follow button state: default shows "Following", hover shows "Unfollow" (toggle on click).
- If the logged-in user is the profile owner: no follow button shown.
- If logged out: no follow button.

### Notification Feed

`/notifications`

- Requires authentication. Redirect to sign-in if not logged in.
- Header: "Notifications" + unread count badge + "Mark all as read" button (only if unreadCount > 0).
- List grouped by day (Today, Yesterday, Earlier this week, etc.).
- Each item: type icon, bold actor name, description, relative timestamp.
- Unread items have a subtle left border or background tint.
- Clicking an item marks it read and navigates:
  - `new_follower` → `/users/:username` (the follower's profile)
  - `new_org_follower` → `/orgs/:slug`
  - `package_starred` → `/packages/:name`
  - `package_commented` → `/packages/:name` (scroll to comments)
  - `new_version` → `/packages/:name`
  - `comment_replied` → `/packages/:name`
  - `package_deprecated` → `/packages/:name`
- Empty state: illustration + "No notifications yet. Follow users and orgs to see activity here."

### Package Page — Comments

`/packages/:name`

Comments section appears below the version metadata, readme, and changelog.

**Header:** "Comments" + comment count badge.

**Comment form** (shown only to authenticated users):
- Textarea: "Leave a comment..." placeholder, min 1 character to submit.
- "Post comment" button. Disabled while empty or submitting.
- On submit error: show inline error message below the button.
- On success: append new comment to the list without full page reload.

**Comment list:**
- Flat list of top-level comments, ordered by `created_at asc`.
- Each comment: avatar, username (linked to profile), timestamp, body, delete button (only if viewer is the comment author).
- Deleted comments show "[deleted]" body text, no avatar.
- "Discuss on GitHub" link at the bottom if the package has a `repository` URL in its metadata.

---

## 5. Notification Generation

Notifications are created server-side after the triggering action completes. A shared helper function `emitNotification(userId, type, payload)` inserts the row. All notification creation lives in one place to ensure consistency.

### Triggers

| Event | Recipients | Notification type |
|---|---|---|
| User A follows User B | B | `new_follower` |
| User A follows Org O | All org owners | `new_org_follower` |
| User A stars Package P | All accounts that starred P | `package_starred` |
| User A comments on Package P | All previous commenters + owner | `package_commented` |
| User A replies to comment on Package P | Parent comment author | `comment_replied` |
| Publisher P publishes v2 of Package P | All accounts that starred P | `new_version` |
| Publisher deprecates Package P | All accounts that starred or depend on P | `package_deprecated` |

### `new_version` / `package_deprecated` batching

When a publisher releases a new version, the system queries all accounts that have starred the package (up to all of them — no cap). For each account, insert one notification. This may produce many rows in a single operation. Use a server-side RPC with batch insert rather than looping in application code.

### `package_commented` deduplication

If the same user comments multiple times on a package, each comment triggers a separate notification. This is intentional — each comment is a distinct event.

---

## 6. Implementation Notes

### Notifications via Edge Function

All notification inserts are performed via a Supabase Edge Function running with the service role key. This keeps RLS simple (no per-user insert policies) while ensuring the `user_id` in the notification row is trusted.

```typescript
// Shared notification emitter — called from API routes and future triggers
export async function emitNotification(
  supabaseAdmin: SupabaseClient,
  userId: string,
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  await supabaseAdmin.from('notifications').insert({
    user_id: userId,
    type,
    payload,
    read: false,
  })
}
```

### Resolving Usernames

User profiles use `user_name` from auth metadata. The `profiles` view or table (if it exists) should be used for avatar URLs. If a user's `user_name` changes, existing notifications will still show the old username in their payload — this is acceptable for v1. Profile pages resolve the current username at render time.

### Following State on Pages

The follow/unfollow state on profile and org pages must be fetched client-side after mount (via `/api/users/:username/followers?limit=1&offset=0` checking if current user is in the list, or a dedicated `GET /api/users/:username/following` check). This avoids SSR complexity for auth-gated state.

---

## 7. Out of Scope (v1)

- Nested/threaded comments (flat only; replies stored but not displayed)
- Comment editing
- Comment reactions or upvotes
- @mentions in comments
- Email delivery
- RSS feeds
- Webhooks
- Push / in-browser notifications
- Notification email digest
- Comment moderation queue
- Blocking users
- Activity pages for orgs
- Follow/unfollow count display on profile (can add later without schema change)

---

## 8. Migration

No schema migrations are needed beyond the new tables. All new tables default to `public` schema.

Run the following migration:

```sql
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

create policy "public read user_follows" on user_follows for select using (true);
create policy "users manage own follows" on user_follows for all using (auth.uid() = follower_id);

create policy "public read org_follows" on org_follows for select using (true);
create policy "users manage own org follows" on org_follows for all using (auth.uid() = follower_id);

create policy "users read own notifications" on notifications for select using (auth.uid() = user_id);
create policy "service role can insert notifications" on notifications for insert with check (true);

create policy "public read package_comments" on package_comments for select using (deleted = false);
create policy "users manage own comments" on package_comments for all using (auth.uid() = user_id);
```
