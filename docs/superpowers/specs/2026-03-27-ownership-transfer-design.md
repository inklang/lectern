# Package Ownership Transfer — Design Spec

**Date:** 2026-03-27
**Feature:** Package Ownership Transfer
**Status:** Draft

---

## Overview

Allow package maintainers to transfer a package to another user or organization. The package slug (and thus its URL) changes to reflect the new owner's namespace (e.g., `alice/my-pkg` becomes `bob/my-pkg`). This matches the behavior of npm, GitHub, and GitLab package transfer flows.

---

## 1. Data Model

### 1.1 `package_transfer_requests` Table

```sql
create table package_transfer_requests (
  id              uuid primary key default gen_random_uuid(),
  package_name    text not null,         -- short name, e.g. "my-pkg"
  from_owner_id   uuid not null,         -- user or org that currently owns
  from_owner_type text not null,         -- 'user' or 'org'
  to_owner_id     uuid not null,         -- user or org receiving ownership
  to_owner_type   text not null,         -- 'user' or 'org'
  new_slug        text not null,         -- full slug after transfer, e.g. "bob/my-pkg"
  status          text not null default 'pending',
                                         -- 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,   -- default: now() + 7 days
  accepted_at     timestamptz,
  declined_at     timestamptz,
  cancelled_at    timestamptz
);
```

**Indexes:**
```sql
create index on package_transfer_requests (package_name);
create index on package_transfer_requests (to_owner_id, status);
create index on package_transfer_requests (from_owner_id, status);
```

**Constraints:**
- `to_owner_id` must differ from `from_owner_id`
- `package_name` must reference an existing package (validated at insert time)

### 1.2 `package_redirects` Table

Created at transfer time to preserve old URLs.

```sql
create table package_redirects (
  old_slug        text primary key,      -- e.g. "alice/my-pkg"
  new_slug        text not null,         -- e.g. "bob/my-pkg"
  created_at      timestamptz not null default now()
);
```

### 1.3 DB Transaction: Slug Rename (on Accept)

When a transfer is accepted, the following updates occur in a single atomic transaction:

```sql
begin;

-- 1. Update packages.slug and owner fields
update packages
set slug          = new_slug,
    owner_slug    = new_owner_slug,   -- e.g. "bob"
    owner_id      = to_owner_id,
    owner_type    = to_owner_type
where name = package_name and slug = old_slug;

-- 2. Update package_versions.package_slug
update package_versions
set package_slug = new_slug
where package_slug = old_slug;

-- 3. Update package_stars.package_name (stores full slug per db.ts analysis)
update package_stars
set package_name = new_slug
where package_name = old_slug;

-- 4. Update package_reviews.package_name
update package_reviews
set package_name = new_slug
where package_name = old_slug;

-- 5. Update download_logs.package_name
update download_logs
set package_name = new_slug
where package_name = old_slug;

-- 6. Update package_tags.package_name
update package_tags
set package_name = new_slug
where package_name = old_slug;

-- 7. Insert redirect record
insert into package_redirects (old_slug, new_slug)
values (old_slug, new_slug);

-- 8. Insert transfer history record
insert into package_transfer_history (package_name, from_owner_id, to_owner_id, new_slug, transferred_at)
values (package_name, from_owner_id, to_owner_id, new_slug, now());

-- 9. Cancel any other pending transfer requests for this package
update package_transfer_requests
set status = 'cancelled', cancelled_at = now()
where package_name = package_name and status = 'pending' and id != current_request_id;

commit;
```

**Note:** `package_tags.package_name` stores the short name (not the full slug), so the rename is `old_short_name → new_short_name`, not `old_slug → new_slug`. See `db.ts` `addPackageTag` / `removePackageTag` — these use `slug.split('/').pop()` for storage.

---

## 2. State Machine

```
pending ──┬── accept ──> accepted (terminal)
          ├── decline ──> declined (terminal)
          ├── cancel ───> cancelled (terminal, by initiator only)
          └── expire ───> expired (terminal, checked on read)
```

- **pending**: Transfer initiated, awaiting recipient action.
- **accepted**: Transfer completed, slug renamed atomically.
- **declined**: Recipient rejected the transfer request.
- **cancelled**: Initiator cancelled before recipient acted.
- **expired**: 7 days elapsed without action; recipient can no longer accept.

Transitions are enforced server-side (invalid transitions throw errors).

---

## 3. API Endpoints

All endpoints require authentication via `Authorization: Bearer <token>`.

### 3.1 `POST /api/packages/[name]/transfer`

**Who can call:** `canManage` on the package (owner_user_id or org admin).

**Request body:**
```json
{
  "toOwnerId": "uuid",
  "toOwnerType": "user" | "org"
}
```

**Behavior:**
1. Validate `toOwnerId` is a valid user or org in Supabase.
2. Validate `canManage` on the package for the authenticated user.
3. Compute `new_slug` = `toOwnerSlug/packageName` (e.g., `bob/my-pkg`).
4. Check that `new_slug` does not already exist in `packages`.
5. Check no **other** pending transfer request exists for this package (one pending request at a time).
6. Insert `package_transfer_requests` row with status `pending`, `expires_at = now() + 7 days`.
7. Create an in-app notification for the recipient (see Section 6).
8. Return the new transfer request.

**Response `201`:**
```json
{
  "id": "uuid",
  "packageName": "my-pkg",
  "fromOwnerId": "uuid",
  "toOwnerId": "uuid",
  "newSlug": "bob/my-pkg",
  "status": "pending",
  "expiresAt": "2026-04-03T00:00:00Z"
}
```

**Error codes:**
- `400` — `toOwnerId` is the current owner, or `new_slug` already taken.
- `403` — Caller does not have `canManage` on the package.
- `404` — Package not found.
- `409` — A pending transfer already exists for this package.

### 3.2 `GET /api/transfers/[id]`

**Who can call:** Initiator (`from_owner_id`) or recipient (`to_owner_id`).

**Response `200`:**
```json
{
  "id": "uuid",
  "packageName": "my-pkg",
  "fromOwner": { "id": "uuid", "username": "alice", "avatarUrl": "..." },
  "toOwner": { "id": "uuid", "username": "bob", "avatarUrl": "..." },
  "newSlug": "bob/my-pkg",
  "oldSlug": "alice/my-pkg",
  "status": "pending",
  "createdAt": "2026-03-27T00:00:00Z",
  "expiresAt": "2026-04-03T00:00:00Z"
}
```

**Error codes:**
- `403` — Caller is neither initiator nor recipient.
- `404` — Transfer request not found.

### 3.3 `POST /api/transfers/[id]/accept`

**Who can call:** `to_owner_id` (the recipient). If `to_owner_type` is `org`, must also be an org admin.

**Behavior:**
1. Validate transfer is still `pending` and not expired.
2. Execute the atomic slug rename transaction (Section 1.3).
3. Update transfer request status to `accepted`, set `accepted_at`.
4. Create in-app notifications for: the initiator (transfer completed), and all package maintainers/starrers who may want to know (optional, see Section 6).
5. Return `200`.

**Response `200`:**
```json
{
  "id": "uuid",
  "status": "accepted",
  "newSlug": "bob/my-pkg",
  "oldSlug": "alice/my-pkg"
}
```

**Error codes:**
- `403` — Caller is not the recipient.
- `404` — Transfer request not found.
- `409` — Transfer is not in `pending` status (already accepted/declined/cancelled/expired).

### 3.4 `POST /api/transfers/[id]/decline`

**Who can call:** `to_owner_id` (the recipient). Same org-admin check as accept.

**Behavior:**
1. Validate transfer is `pending` and not expired.
2. Update status to `declined`, set `declined_at`.
3. Notify initiator via in-app notification.

**Response `200`:**
```json
{
  "id": "uuid",
  "status": "declined"
}
```

### 3.5 `DELETE /api/transfers/[id]`

**Who can call:** Initiator (`from_owner_id`) only.

**Behavior:**
1. Validate transfer is `pending`.
2. Update status to `cancelled`, set `cancelled_at`.
3. No notification needed (initiator initiated the cancellation).

**Response `200`:**
```json
{
  "id": "uuid",
  "status": "cancelled"
}
```

---

## 4. Redirects

### 4.1 Database Lookup

On every package page load (`src/pages/[user]/[slug]/index.astro`), check:
```sql
select new_slug from package_redirects where old_slug = current_slug;
```
If a redirect exists, serve HTTP `301` to the new URL.

### 4.2 Response Headers

For a migrated package, the new URL page response includes:
```
X-Package-Migrated-From: <old_slug>
```

### 4.3 Redirect Listing Page

`/transfers/redirects` (settings page) lists all redirects for packages the user owns or manages. Users can optionally delete a redirect (if they are certain no one depends on the old URL anymore), but the redirect is always created at transfer time and is permanent by default.

### 4.4 Dependency References Warning

At accept time, before committing the transaction, run:
```sql
select distinct pd.package_name, pd.version, pd.dep_version
from package_versions pv
join jsonb_each_text(pv.dependencies) as pd(dep_name, dep_version) on true
join packages p on p.name = pd.dep_name
where pd.dep_name = package_name;
```

This returns all packages that list the transferred package as a dependency. After the transfer completes, display a **dependency audit warning** in the transfer completion UI:

> "This package is a dependency of N other package(s) on lectern.ink. Those packages may need to update their dependency reference to the new slug. Old slug: `alice/my-pkg` → New slug: `bob/my-pkg`."

The warning is informational only — ink package manager on the consumer side handles the actual dependency resolution.

---

## 5. Access Control

### 5.1 `canManage` — Initiate Transfer

Uses the existing `canManage(userId, packageName)` logic in `authz.ts`:
- User owns the package (`owner_id = userId AND owner_type = 'user'`).
- Org member with `owner` or `admin` role when `owner_type = 'org'`.

### 5.2 Recipient — Accept / Decline

- **User recipient:** `auth.uid() = to_owner_id`.
- **Org recipient:** `auth.uid()` must be an org admin (role `owner` or `admin` in `org_members`).

### 5.3 Transfer Visibility

Only the initiator and recipient can see a transfer request. No public listing of pending transfers.

---

## 6. Notifications Integration

### 6.1 Notification Table (extend existing)

The existing `notifications` table (or a new `package_transfer_notifications` table) stores:

```json
{
  "id": "uuid",
  "user_id": "uuid",          -- recipient or initiator
  "type": "transfer_requested" | "transfer_accepted" | "transfer_declined" | "transfer_cancelled",
  "transfer_id": "uuid",
  "package_name": "my-pkg",
  "new_slug": "bob/my-pkg",
  "from_username": "alice",
  "read": false,
  "created_at": "..."
}
```

### 6.2 Notification Events

| Event | Recipient | Message |
|---|---|---|
| `transfer_requested` | `to_owner_id` | "alice wants to transfer `my-pkg` to you. Accept or decline." |
| `transfer_accepted` | `from_owner_id` | "bob accepted transfer of `my-pkg`. It is now at `bob/my-pkg`." |
| `transfer_declined` | `from_owner_id` | "bob declined transfer of `my-pkg`." |
| `transfer_cancelled` | (no notification) | — |

### 6.3 Email Notifications (Future)

Email is out of scope for this spec. In-app notifications on the `/notifications` page are sufficient for MVP.

---

## 7. UI

### 7.1 Transfer Button in Package Settings

**Location:** `src/pages/[user]/[slug]/settings/index.astro`

A "Transfer Ownership" button at the bottom of the settings page (under a "Danger Zone" section).

**Click flow:**
1. Modal opens: "Transfer `alice/my-pkg` to:"
   - Search/select field for user or org (typeahead from `/api/search/users?q=...` and `/api/search/orgs?q=...`)
   - Preview of new slug: `bob/my-pkg`
   - Warning: "This will change the package URL. All existing URLs will redirect permanently."
2. Confirm button.
3. On success: "Transfer request sent to bob@example.com" (or username if in-app).

**Validation:**
- Disable confirm if new slug already exists.
- Disable confirm if target is the current owner.
- Disable confirm if a pending transfer already exists.

### 7.2 Recipient Notifications Page Banner

**Location:** `src/pages/notifications.astro`

When user has a pending `transfer_requested` notification:
- Show a dismissible banner at the top:
  > "alice wants to transfer `alice/my-pkg` to you. [Accept] [Decline]"
- The banner links to the transfer detail page.

### 7.3 Transfer Detail Page

**Location:** `/transfers/[id]`

Shows:
- Package name, old slug → new slug
- Initiator info, recipient info
- Status badge
- Action buttons: Accept / Decline / Cancel (context-dependent)
- Dependency audit warning (if any dependents exist)
- Transfer history for this package (past transfers)

### 7.4 Initiator: Pending Transfer Indicator

On the package settings page, if a pending transfer exists:
- Show "Transfer pending" badge.
- Show "Cancel transfer" button.
- Show recipient info.

---

## 8. Out of Scope

- **Email notifications** — In-app only for MVP.
- **Automatic dependency updates** — Informational warning only.
- **Transfer to a user who already has a package with the same short name** — Blocked at API level with `409`.
- **Bulk transfer** — One package at a time.
- **Transfer reversal** — After accepted, no automatic reversal. User must manually transfer back.

---

## 9. Security Considerations

- Transfer tokens are not used in URLs (in contrast to a claim-token approach). All actions require authenticated sessions.
- Only the initiator can cancel a pending transfer.
- Only the recipient can accept or decline.
- The old slug is preserved as a permanent redirect, ensuring no broken links for existing users.
- The `package_redirects` table is append-only (no deletion in the main flow), preventing URL hijacking.
- Rate limiting: Max 1 pending transfer per package at a time; max 5 transfer initiations per user per hour.

---

## 10. Migration / Rollout

This feature requires a new Supabase migration:

1. Create `package_transfer_requests` table + indexes + RLS policies.
2. Create `package_redirects` table + indexes + RLS policies.
3. Add `package_transfer_history` table (for audit trail, optional for MVP — can be added later).
4. Add RLS policies:
   - Users can insert `package_transfer_requests` if they `canManage` the package.
   - Initiator and recipient can read their own transfer requests.
   - Only recipient can update (accept/decline) a transfer request.
   - Only initiator can cancel their own pending request.
   - Anyone can read `package_redirects` (public redirect resolution).
   - Only the new owner can delete a redirect record.
