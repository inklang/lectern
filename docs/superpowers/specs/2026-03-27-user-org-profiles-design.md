# Design: User & Org Profiles

**Date:** 2026-03-27

## Overview

Add rich user and org profile pages to Lectern. Users get a dedicated `/u/[username]` URL namespace; orgs keep their existing `/{org}` URL. Both share a set of profile components for consistent UI. Profiles include a bio, website, social links (GitHub, Twitter/X), avatar, banner (orgs only for now), pinned packages, and follower/following counts. The follow system (from the existing `follows.ts` lib) is integrated into the profile UI.

---

## 1. URL Structure

| Entity | URL | Notes |
|--------|-----|-------|
| User | `/u/[username]` | New page `src/pages/u/[username].astro` |
| Org | `/[org]` | Existing page `src/pages/org/[slug].astro`, enhanced |

Users who are also org owners have both a user profile at `/u/[username]` and an org profile at `/[org]`. These are separate pages with different content.

Redirects: if a user tries to visit the old-style `/[username]` path where `username` is a valid user (not an org), redirect to `/u/[username]`. This is handled by the existing `org/[slug].astro` which already checks both tables.

---

## 2. Data Model

### Migration: add columns to `users` table

```sql
alter table users add column bio text;
alter table users add column website text;
alter table users add column twitter text;
alter table users add column github text;
alter table users add column avatar_url text;
```

Each field is nullable. `avatar_url` uses Supabase Storage (same bucket approach as org avatars — `org-assets` bucket, or a new `user-assets` bucket). RLS policies mirror org avatar policies: public read, user writes their own.

### Org table (no new columns needed)

Orgs already have `avatar_url` and `banner_url` from migration 013. Org bio, website, and social links are not in scope for this migration — org profile enhancements use the existing org name/description only.

### Pinned packages

```sql
create table user_pinned_packages (
  user_id       uuid references auth.users on delete cascade,
  package_name  text not null,
  pinned_at     timestamptz default now(),
  position      integer not null default 0,
  primary key (user_id, package_name)
);

alter table user_pinned_packages enable row level security;

-- Public read
create policy "public read pinned packages" on user_pinned_packages for select using (true);

-- User can insert/delete their own pins
create policy "users manage own pins" on user_pinned_packages
  for insert with check (auth.uid() = user_id);

create policy "users delete own pins" on user_pinned_packages
  for delete using (auth.uid() = user_id);

-- Optional: org pinned packages (same table, different owner type in a future migration)
-- For now, only users can pin. Org pin feature is a future extension.
```

`position` allows ordering (0 = first slot). Max pins per user: 6 (enforced in the app layer, not DB).

### Existing tables used

| Table | Usage |
|-------|-------|
| `users` | User profile data (bio, website, twitter, github, avatar_url) |
| `orgs` | Org profile data (avatar_url, banner_url already exist) |
| `packages` | Package listings per user/org |
| `package_stars` | Star counts for packages |
| `user_follows` | Follower/following counts for users |
| `org_follows` | Follower counts for orgs |
| `user_pinned_packages` | New table for pinned packages |

---

## 3. DB Migration

```sql
-- User profile columns
alter table users add column bio text;
alter table users add column website text;
alter table users add column twitter text;
alter table users add column github text;
alter table users add column avatar_url text;

-- Pinned packages
create table user_pinned_packages (
  user_id       uuid references auth.users on delete cascade,
  package_name  text not null,
  pinned_at     timestamptz default now(),
  position      integer not null default 0,
  primary key (user_id, package_name)
);

alter table user_pinned_packages enable row level security;

create policy "public read pinned packages" on user_pinned_packages for select using (true);
create policy "users manage own pins" on user_pinned_packages
  for insert with check (auth.uid() = user_id);
create policy "users delete own pins" on user_pinned_packages
  for delete using (auth.uid() = user_id);
```

RLS policies for `users` table already allow public read and self-update (from migration 017).

---

## 4. Access Control

| Action | Who |
|--------|-----|
| View any user/org profile | Public |
| Edit own user profile fields (bio, website, twitter, github, avatar_url) | User (auth.uid() = user id) |
| Update org profile (name, description, avatar, banner) | Org owner or admin (`isOrgAdmin` check) |
| Pin/unpin own packages | User (auth.uid() = user id) |
| Follow/unfollow a user or org | Authenticated user |
| View followers/following lists | Public |

Profile editing is done via a settings subpage (`/u/[username]/settings`) for users, and the existing `org/[slug]/settings` for orgs. No public profile editing forms — only the authenticated owner can edit.

---

## 5. `users.ts` Library Functions (new file)

**File:** `src/lib/users.ts`

```typescript
import { supabase } from './supabase.js'

export interface UserProfile {
  id: string
  user_name: string
  email?: string
  bio?: string
  website?: string
  twitter?: string
  github?: string
  avatar_url?: string
  created_at: string
}

// Fetch a user's public profile by username.
export async function getUserProfile(username: string): Promise<UserProfile | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('user_name', username)
    .single()
  return data ?? null
}

// Update a user's own profile. Returns the updated row.
export async function updateUserProfile(
  userId: string,
  updates: {
    bio?: string
    website?: string
    twitter?: string
    github?: string
    avatar_url?: string
  }
): Promise<UserProfile> {
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data
}

// Get packages a user has starred (for the "Starred" tab on profile).
export async function getUserStarredPackages(
  userId: string,
  limit = 20,
  offset = 0
): Promise<{ packageName: string; starredAt: string }[]> {
  const { data, error } = await supabase
    .from('package_stars')
    .select('package_name, starred_at')
    .eq('user_id', userId)
    .order('starred_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw error
  return (data ?? []).map(r => ({
    packageName: r.package_name,
    starredAt: r.starred_at,
  }))
}

// Get packages a user has pinned.
export async function getUserPinnedPackages(
  userId: string
): Promise<{ packageName: string; pinnedAt: string; position: number }[]> {
  const { data, error } = await supabase
    .from('user_pinned_packages')
    .select('package_name, pinned_at, position')
    .eq('user_id', userId)
    .order('position', { ascending: true })
  if (error) throw error
  return (data ?? []).map(r => ({
    packageName: r.package_name,
    pinnedAt: r.pinned_at,
    position: r.position,
  }))
}

// Pin a package. Idempotent (no error if already pinned).
export async function pinPackage(
  userId: string,
  packageName: string,
  position: number
): Promise<void> {
  const { error } = await supabase
    .from('user_pinned_packages')
    .upsert(
      { user_id: userId, package_name: packageName, position },
      { onConflict: 'user_id,package_name' }
    )
  if (error) throw error
}

// Unpin a package.
export async function unpinPackage(userId: string, packageName: string): Promise<void> {
  const { error } = await supabase
    .from('user_pinned_packages')
    .delete()
    .eq('user_id', userId)
    .eq('package_name', packageName)
  if (error) throw error
}

// Get follower count for a user.
export async function getUserFollowerCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('user_follows')
    .select('*', { count: 'exact', head: true })
    .eq('following_id', userId)
  if (error) throw error
  return count ?? 0
}

// Get following count for a user.
export async function getUserFollowingCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('user_follows')
    .select('*', { count: 'exact', head: true })
    .eq('follower_id', userId)
  if (error) throw error
  return count ?? 0
}

// Get follower count for an org.
export async function getOrgFollowerCount(orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from('org_follows')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
  if (error) throw error
  return count ?? 0
}
```

---

## 6. Shared Components

### `src/components/profile/ProfileHeader.astro`

Shared header used by both user and org profile pages.

**Props:**
```typescript
interface Props {
  type: 'user' | 'org'
  name: string          // display name (org name or username)
  slug: string          // @slug for display
  avatarUrl?: string | null
  bannerUrl?: string | null  // only relevant for orgs; ignored for users
  bio?: string | null
  website?: string | null
  twitter?: string | null
  github?: string | null
  isOwner?: boolean     // shows "Edit profile" button if true
  editHref?: string     // URL for the edit button
  followerCount?: number
  followingCount?: number
  packageCount?: number
  isFollowing?: boolean  // if viewer is logged in and following
}
```

**Renders:**
- Banner image (orgs only, hidden for users)
- Avatar (with CSS fallback initial if no avatar_url)
- `@slug` in monospace muted text
- Display name (h1, monospace)
- Bio paragraph (if present)
- Website link (if present, rendered as icon + URL)
- Twitter/X link (if present, rendered as icon)
- GitHub link (if present, rendered as icon)
- Follower / following / package stats row (via `ProfileStats`)
- "Edit Profile" button (if `isOwner`) or "Follow" / "Unfollow" button (if `!isOwner` and logged in)

**CSS fallback for avatar:**
```javascript
function getAvatarColor(slug: string): string {
  let hash = 0
  for (let i = 0; i < slug.length; i++) {
    hash = slug.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = hash % 360
  return `hsl(${hue}, 50%, 40%)`
}
```

### `src/components/profile/ProfileStats.astro`

Compact stats row component.

**Props:**
```typescript
interface Props {
  packages?: number
  followers?: number
  following?: number
  teams?: number  // orgs only
  members?: number // orgs only
}
```

**Renders:** A flex row of stat blocks. Each block: large monospace number + small uppercase muted label. Adapts based on which props are provided (user profiles show packages/followers/following; org profiles show packages/members/teams).

### `src/components/profile/PackageGrid.astro`

Grid of package cards, used by both user and org profile pages.

**Props:**
```typescript
interface Props {
  packages: Array<{
    name: string
    slug: string
    display_name?: string
    description?: string
    version?: string
    star_count?: number
    created_at: string
  }>
  showPinButton?: boolean   // if owner is viewing, show pin/unpin icons
  pinnedPackageNames?: Set<string>
  starredPackageNames?: Set<string>
  emptyMessage?: string
}
```

**Renders:**
- Responsive grid (1 col mobile, 2 col tablet, 3 col desktop)
- Each card: package name (monospace), description, latest version badge, star count, relative date
- Pin button on each card (filled pin icon if pinned, outline if not) — only shown if `showPinButton` is true
- Star indicator (filled star if the viewer has starred it — only if `starredPackageNames` is provided)
- Empty state with configurable message

---

## 7. User Profile Page

**File:** `src/pages/u/[username].astro` (new)

### Route

`/u/[username]` — Astro SSR page, prerendered is `false`.

### Server-side load

1. Get `username` from `Astro.params`.
2. Call `getUserProfile(username)`. If null, return 404.
3. Fetch packages owned by this user (`owner_type = 'user'`, `owner_id = user.id`).
4. Fetch pinned packages via `getUserPinnedPackages(user.id)`.
5. Fetch starred packages via `getUserStarredPackages(user.id)`.
6. Fetch follower count via `getUserFollowerCount(user.id)`.
7. Fetch following count via `getUserFollowingCount(user.id)`.
8. If session exists and viewer is not the profile owner, call `isFollowingUser(viewerId, user.id)`.
9. Call `getOrgBySlug` for any orgs the user belongs to (for "Member of" section, optional — can be deferred).

### Tabs

| Tab | Content |
|-----|---------|
| Packages | All published packages (from step 3) |
| Pinned | User's pinned packages (from step 4), max 6 |
| Starred | Packages the user has starred (from step 5) |
| Followers | Follower list (usernames, links to `/u/[username]`), paginated |
| Following | Following list (usernames, links to `/u/[username]`), paginated |

Tabs are client-side tab switching (same pattern as existing org page). Followers/Following tabs make client-side fetch calls to load the list on tab activation.

### Follow button behavior

- If not logged in: clicking Follow redirects to `/login?next=/u/[username]`.
- If logged in as someone else: calls `followUser(viewerId, profileUserId)` or `unfollowUser(...)` via a `POST /api/follow` endpoint (or inline API route). Button toggles between "Follow" and "Following".

### Edit profile

If `isOwner` is true, show "Edit Profile" button in the header linking to `/u/[username]/settings`.

### Settings subpage: `/u/[username]/settings`

A settings page for the authenticated user to edit their profile fields.

**Form fields:**
- Bio (textarea, max 300 chars)
- Website (text input, URL validated)
- Twitter/X handle (text input, with or without @)
- GitHub username (text input)

On save: calls `updateUserProfile(userId, formData)`.

Avatar upload: if time allows, add an avatar upload widget. Otherwise, avatar_url is set via GitHub OAuth metadata sync (initial avatar from GitHub on signup) and not editable through this form.

---

## 8. Org Profile Enhancements

**File:** `src/pages/org/[slug].astro` (existing, enhanced)

### Changes

1. **New header layout:** Replace inline header HTML with the new `ProfileHeader.astro` component. Pass `isOwner = isOrgAdmin(org.id, session?.user?.id)`. Pass `editHref = /org/[slug]/settings`.

2. **Tabs:** Extend the existing two tabs (Packages, Teams) with:
   - **Pinned Packages** — if the org has any pinned packages (future: org pinned packages table — not in initial scope, but tab structure should be ready for it).
   - **Followers** — paginated list of org followers (fetch from `getOrgFollowers(org.id)`).

3. **Package cards:** Replace inline package card HTML with `PackageGrid.astro`.

4. **Follow button:** In the header, show Follow/Unfollow button for orgs (already has `followOrg` / `unfollowOrg` in `follows.ts`).

5. **Banner:** Already renders `org.banner_url` if present — this is unchanged.

---

## 9. API Endpoints

### `POST /api/follow`

Follow a user or org.

**Request:**
```json
{ "type": "user" | "org", "targetId": "uuid or org-id" }
```

**Response `200`:** `{ "following": true }`

Errors: `401` (not authenticated), `404` (target not found).

### `DELETE /api/follow`

Unfollow a user or org.

**Request:**
```json
{ "type": "user" | "org", "targetId": "uuid or org-id" }
```

**Response `200`:** `{ "following": false }`

### `GET /api/profile/[username]/followers`

Get paginated followers for a user profile.

**Query params:** `limit` (default 20), `offset` (default 0).

**Response `200`:**
```json
{
  "followers": [{ "userId": "uuid", "userName": "chaosinferno" }],
  "total": 42
}
```

### `GET /api/profile/[username]/following`

Get paginated following for a user profile.

**Query params:** `limit` (default 20), `offset` (default 0).

**Response `200`:**
```json
{
  "following": [{ "userId": "uuid", "userName": "inkteam" }],
  "total": 7
}
```

### `POST /api/pins`

Pin a package to your profile.

**Request:**
```json
{ "packageName": "foo" }
```

**Response `200`:** `{ "pinned": true }`

Errors: `401` (not authenticated), `400` (max 6 pins reached).

### `DELETE /api/pins`

Unpin a package from your profile.

**Request:**
```json
{ "packageName": "foo" }
```

**Response `200`:** `{ "pinned": false }`

### `PATCH /api/profile`

Update your user profile.

**Request:**
```json
{
  "bio": "...",
  "website": "https://...",
  "twitter": "handle",
  "github": "username"
}
```

All fields optional. Only provided fields are updated.

**Response `200`:** Full updated `UserProfile` object.

Errors: `401` (not authenticated), `400` (validation error).

---

## 10. Out of Scope

- Org bio, website, and social links on org profile (org enhancements are limited to pinned packages UI structure and followers tab)
- Org pinned packages (only user pinned packages in this migration)
- Avatar upload widget on user settings page (avatar comes from GitHub OAuth sync; manual upload is a future enhancement)
- User profile cover/banner image
- Verified badge display on profiles (the `verified` column on orgs exists; display logic is separate)
- Email verification before allowing profile edits
- Activity feed on profile pages

---

## 11. File Summary

| File | Action |
|------|--------|
| `supabase/migrations/022_user_profiles.sql` | New migration for `users` columns + `user_pinned_packages` table |
| `src/lib/users.ts` | New library with all user-profile DB functions |
| `src/pages/u/[username].astro` | New user profile page |
| `src/pages/u/[username]/settings.astro` | New user settings subpage |
| `src/components/profile/ProfileHeader.astro` | New shared profile header component |
| `src/components/profile/ProfileStats.astro` | New shared stats row component |
| `src/components/profile/PackageGrid.astro` | New shared package grid component |
| `src/pages/org/[slug].astro` | Enhanced org profile page (use new components, add tabs) |
| `src/pages/api/follow.ts` | New API route for follow/unfollow |
| `src/pages/api/profile/[username]/followers.ts` | New API route for follower list |
| `src/pages/api/profile/[username]/following.ts` | New API route for following list |
| `src/pages/api/pins.ts` | New API route for pin/unpin |
| `src/pages/api/profile.ts` | New API route for profile updates |
