# Design: Package Starring

**Date:** 2026-03-25

## Overview

Add GitHub-style starring to Lectern packages. Users can star packages to signal quality/appreciation, and packages can be sorted by star count on the browse page alongside existing sort options (chronological, trending).

Stars are public — anyone can see who starred what and the total star count. This mirrors GitHub's model and encourages community curation.

---

## 1. Data Model

### New table

```sql
create table package_stars (
  user_id      uuid references auth.users on delete cascade,
  package_name text not null,                              -- references packages.name
  starred_at   timestamptz default now(),
  primary key (user_id, package_name)
);
```

- `(user_id, package_name)` is the primary key to prevent duplicate stars.
- `starred_at` enables ordering by most recently starred (future "starred by you" feed).
- No separate star count column on `packages` — count is derived with `count(*) over (partition by package_name)` in queries. This avoids stale count drift.

### Migration: initial state

```sql
alter table package_stars enable row level security;

-- Anyone can read stars (public by design)
create policy "public read stars" on package_stars for select using (true);

-- Only the starring user can insert/delete their own stars
create policy "users manage own stars" on package_stars
  for insert with check (auth.uid() = user_id);

create policy "users delete own stars" on package_stars
  for delete using (auth.uid() = user_id);
```

---

## 2. API Endpoints

### `PUT /api/packages/:name/star`

Star a package. Requires authentication.

Request: no body needed.

Response `200`: `{ "starred": true, "starCount": 42 }`

Errors:
- `401` — not authenticated
- `404` — package does not exist
- `409` — already starred (idempotent: return 200 with current state)

### `DELETE /api/packages/:name/star`

Unstar a package. Requires authentication.

Request: no body needed.

Response `200`: `{ "starred": false, "starCount": 41 }`

Errors:
- `401` — not authenticated
- `404` — package does not exist or not starred

### `GET /api/packages/:name/star`

Check if the authenticated user has starred a package. Used by the package detail page to show the filled/unfilled star button.

Request: requires `Authorization: Bearer <token>` header.

Response `200`: `{ "starred": true }`

Errors:
- `401` — not authenticated

### `GET /api/packages/:name/stars`

Get star count and list of starrers for a package. Public.

Query params:
- `limit` (default 20, max 100) — number of starrers to return
- `offset` (default 0) — pagination offset

Response `200`:
```json
{
  "starCount": 42,
  "starrers": [
    { "userId": "uuid", "starredAt": "2026-03-20T..." },
    ...
  ]
}
```

### `GET /api/users/:userId/stars` (optional)

List packages a user has starred. Public.

Query params:
- `limit` (default 20, max 100)
- `offset` (default 0)

Response `200`:
```json
{
  "stars": [
    { "packageName": "foo", "starredAt": "2026-03-20T..." },
    ...
  ],
  "total": 7
}
```

---

## 3. `db.ts` Functions

```typescript
// Star a package for a user. Idempotent (no error if already starred).
export async function starPackage(userId: string, packageName: string): Promise<void> {
  const { error } = await supabase
    .from('package_stars')
    .upsert({ user_id: userId, package_name: packageName }, { onConflict: 'user_id,package_name' })
  if (error) throw error
}

// Unstar a package for a user.
export async function unstarPackage(userId: string, packageName: string): Promise<void> {
  const { error } = await supabase
    .from('package_stars')
    .delete()
    .eq('user_id', userId)
    .eq('package_name', packageName)
  if (error) throw error
}

// Returns true if the user has starred the package.
export async function hasStarred(userId: string, packageName: string): Promise<boolean> {
  const { data } = await supabase
    .from('package_stars')
    .select('user_id')
    .eq('user_id', userId)
    .eq('package_name', packageName)
    .single()
  return !!data
}

// Get star count for a package.
export async function getStarCount(packageName: string): Promise<number> {
  const { count, error } = await supabase
    .from('package_stars')
    .select('*', { count: 'exact', head: true })
    .eq('package_name', packageName)
  if (error) throw error
  return count ?? 0
}

// Get star counts for multiple packages (batch). Returns map of package_name -> count.
export async function getStarCounts(packageNames: string[]): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('package_stars')
    .select('package_name')
  if (error) throw error

  const counts: Record<string, number> = {}
  for (const name of packageNames) counts[name] = 0
  for (const row of data ?? []) {
    if (counts.hasOwnProperty(row.package_name)) counts[row.package_name]++
  }
  return counts
}

// Get paginated starrers for a package.
export async function getPackageStarrers(
  packageName: string,
  limitCount = 20,
  offsetCount = 0
): Promise<{ userId: string; starredAt: string }[]> {
  const { data, error } = await supabase
    .from('package_stars')
    .select('user_id, starred_at')
    .eq('package_name', packageName)
    .order('starred_at', { ascending: false })
    .range(offsetCount, offsetCount + limitCount - 1)
  if (error) throw error
  return (data ?? []).map(r => ({ userId: r.user_id, starredAt: r.starred_at }))
}

// Get packages a user has starred.
export async function getUserStars(
  userId: string,
  limitCount = 20,
  offsetCount = 0
): Promise<{ packageName: string; starredAt: string }[]> {
  const { data, error } = await supabase
    .from('package_stars')
    .select('package_name, starred_at')
    .eq('user_id', userId)
    .order('starred_at', { ascending: false })
    .range(offsetCount, offsetCount + limitCount - 1)
  if (error) throw error
  return (data ?? []).map(r => ({ packageName: r.package_name, starredAt: r.starred_at }))
}
```

---

## 4. Package Detail Page (`/packages/[name]`)

### Star button

In the `.pkg-header` section, alongside the download count, add a star button:

```html
<button class="star-btn" data-package="pkg-name" aria-label="Star this package">
  <span class="star-icon">☆</span>
  <span class="star-count">42</span>
</button>
```

The button is a client-side component that:
1. On page load: calls `GET /api/packages/:name/star` (with auth header if session exists) to determine if the current user has starred.
2. If authenticated and has starred: fills the star icon (★) and applies `.starred` class.
3. On click (authenticated user): calls `PUT /api/packages/:name/star` to star, or `DELETE` to unstar, and toggles the filled state + updates count optimistically.
4. On click (unauthenticated user): redirects to login page (`/login?next=/packages/:name`).

### Star count display

Below the star button or in the header, show total star count:
```html
<span class="star-count-display">42 stars</span>
```

This count comes from `getStarCount()` in the page's server-side load.

### Who starred section (optional, stretch goal)

Below dependents, add a "starrers" section showing avatars/usernames of the most recent starrers (up to 5). Each starrer links to their profile.

---

## 5. Browse Page Sort by Stars (`/packages`)

### Sort options

Extend the existing browse page with a `sort` query param. Current options are chronological (default) and tag-filtered. Add `stars`:

| URL | Behavior |
|-----|----------|
| `/packages` | chronological (default, `published_at desc`) |
| `/packages?sort=stars` | highest star count first |
| `/packages?sort=trending` | existing trending logic (downloads over 7 days) |
| `/packages?tag=foo&sort=stars` | filtered by tag, sorted by stars |

### `db.ts` function

```typescript
// Returns packages sorted by star count, with star counts.
export async function listPackagesByStars(
  limitCount = 20,
  offsetCount = 0
): Promise<{ packageName: string; starCount: number }[]> {
  const { data, error } = await supabase
    .from('package_stars')
    .select('package_name')
  if (error) throw error

  // Count stars per package
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    counts[row.package_name] = (counts[row.package_name] ?? 0) + 1
  }

  // Sort by count descending, apply pagination
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(offsetCount, offsetCount + limitCount)
    .map(([package_name, star_count]) => ({ packageName: package_name, starCount: star_count }))

  return sorted
}
```

Note: For large datasets, this count approach is inefficient. A future optimization would add a `star_count` column to the `packages` table updated via a trigger on `package_stars`, or use a materialized view. Storing at the package level (like `download_count` on `package_versions`) is a good trade-off.

### Package cards — star count

In `.pkg-card`, add a star count indicator on the right side alongside the version badge:

```html
<div class="pkg-right">
  <div class="pkg-star-count">★ 42</div>
  <div class="pkg-ver">v1.2.3</div>
  <div class="pkg-date">Mar 20, 2026</div>
</div>
```

CSS:
```css
.pkg-star-count {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--star-color, #f59e0b);  /* amber/gold */
}
```

Star counts on cards require fetching counts for the visible page of packages. Use `getStarCounts([name1, name2, ...])` with the batch function.

---

## 6. Authentication

Starring requires authentication. The CLI token (from `Authorization: Bearer <token>`) is the same token used for publishing.

For web UI: the existing session cookie approach (Supabase auth) handles this. The star button on the detail page checks `Astro.locals.user` (or equivalent session) to determine if the user is logged in.

Unauthenticated star attempts return `401` with message "Login to star packages."

---

## 7. RLS Policies Summary

| Operation | Who |
|-----------|-----|
| `SELECT` on `package_stars` | Public (anyone can see who starred what) |
| `INSERT` | Authenticated user inserting their own star |
| `DELETE` | Authenticated user deleting their own star |

No admin or owner check — any authenticated user can star/unstar any public package.

---

## 8. Out of Scope

- Private stars (hidden from other users) — stars are public by design
- Starred-by-user view on profile page (basic `/api/users/:id/stars` endpoint is listed above but page UI is out of scope)
- Star notifications (notify package owners when their package gets a star)
- Star graphs/history (when a package crossed N stars)
- Trending by stars (a "most starred this week" sort — can be added later with a time-windowed count)
- Editing/deleting a star after the fact (stars are immutable events; unstar + re-star to change `starred_at`)

---

## 9. Migration

```sql
-- Create package_stars table
create table package_stars (
  user_id      uuid references auth.users on delete cascade,
  package_name text not null,
  starred_at   timestamptz default now(),
  primary key (user_id, package_name)
);

alter table package_stars enable row level security;

create policy "public read stars" on package_stars for select using (true);
create policy "users manage own stars" on package_stars
  for insert with check (auth.uid() = user_id);
create policy "users delete own stars" on package_stars
  for delete using (auth.uid() = user_id);

-- Optional: add star_count to packages table for O(1) lookups and easier sorting
-- (avoids counting rows at read time; updated via trigger below)
alter table packages add column star_count integer not null default 0;

create or replace function update_package_star_count()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update packages set star_count = star_count + 1 where name = NEW.package_name;
  elsif TG_OP = 'DELETE' then
    update packages set star_count = star_count - 1 where name = OLD.package_name;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create trigger trigger_update_star_count
after insert or delete on package_stars
for each row execute function update_package_star_count();

-- Migration: backfill star_count from existing stars
update packages set star_count = (
  select count(*) from package_stars where package_stars.package_name = packages.name
);
```
