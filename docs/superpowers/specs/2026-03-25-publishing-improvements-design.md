# Publishing Improvements Design

**Date:** 2026-03-25
**Status:** Draft

## Overview

This spec covers four publishing improvements for Lectern: scoped packages, preview (unlisted) releases, release gating with human approval, and monorepo batch publishing.

---

## 1. Scoped Packages

### Goal

Support package names with an `@scope/` prefix to enable org-namespace isolation and user-namespace isolation, alongside existing unscoped packages.

### Scope Types

| Scope | Example | Owner | Publish permission |
|---|---|---|---|
| Org scope | `@inklang/react` | Org (`inklang`) | Org members with `write` or `admin` on the package |
| User scope | `@justin/pkg` | User (`justin`) | The user themselves |
| Unscoped | `react` | User or org | Owner or org member with `write`/`admin` |

### Name Validation

- Scoped names must match: `^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$`
- The scope component (org slug or username) is case-insensitive, stored lowercase
- No wildcard or protected scope names (e.g., `@lectern`, `@www`)
- Scope component must match an existing org slug or username — no orphaned scopes
- Unscoped names must match: `^[a-z0-9][a-z0-9-]*$` (existing validation)

### Collision Rules

- `@org/foo` cannot be created if an org with slug `org` exists
- `@user/foo` cannot be created if a user with username `user` exists
- `@org/foo` cannot be created if an unscoped package `foo` already exists and is org-owned by a different org
- Unscoped names are globally unique regardless of scope

### Database Changes

**`packages` table:**

| Column | Type | Notes |
|---|---|---|
| `name` | `text` | Full name including `@` and scope, e.g., `@inklang/react`. PK. Case-sensitive for storage; scope normalized to lowercase on write. |
| `scope_type` | `text` | `'org'` / `'user'` / `null`. `null` = unscoped. |
| `scope_id` | `uuid` | FK to `orgs.id` or `auth.users.id` depending on `scope_type`. `null` for unscoped. |

Existing packages: `scope_type = NULL`, `scope_id = NULL`.

**Indexes:**

- Unique partial index on `(lower(scope_id), name)` for org/user-scoped packages
- Existing PK and unique index on `name` continues to enforce global uniqueness

### API Changes

**Publishing (`PUT /api/packages/:name/:version`):**

- Route handles both scoped and unscoped: `:name` captures `@org/pkg` or `unscoped-pkg`
- Authz checks extended:
  - Org scope: user must be org member with `write` or `admin` on this package
  - User scope: user must be the scope owner
  - Unscoped: unchanged (user owner or org member with permission)
- New required field in publish payload: `scope_type` (sent implicitly by route structure, validated server-side)

**Reading (`GET /api/packages/:name`):**

- Works identically for scoped and unscoped — returns version list, latest, metadata
- Unlisted versions filtered unless `?include_unlisted=true` and caller is the owner

**Org-scoped packages in org context:**

- Listed under the org's packages page (`/[slug]/packages`)
- Org settings includes permission management for scoped packages via existing teams UI

### Ink CLI Impact

- `quill publish` detects `@scope/` prefix and routes to scoped endpoint
- `quill install @org/pkg` fetches `@org/pkg` from registry
- Auth token includes scope permissions

---

## 2. Preview (Unlisted) Releases

### Goal

Allow publishing versions that are installable via explicit version spec but hidden from search, trending, and discovery. These are preview/alpha/beta releases that don't affect the package's `latest` version.

### Visibility Levels

| Level | Searchable | Trending | `latest` eligible | Installable |
|---|---|---|---|---|
| `public` (default) | Yes | Yes | Yes | Yes |
| `unlisted` | No | No | No | Yes (explicit version only) |

### Database Changes

**`package_versions` table — add column:**

| Column | Type | Notes |
|---|---|---|
| `visibility` | `text` | `'public'` (default) or `'unlisted'`. Default can be set via migration: `ALTER TABLE package_versions ALTER COLUMN visibility SET DEFAULT 'public'` |

Existing versions: `visibility = 'public'`.

### API Changes

**Publishing (`PUT /api/packages/:name/:version`):**

- Accept new optional field: `visibility: "public" | "unlisted"` (default: `"public"`)
- In multipart form: `visibility=unlisted`
- In legacy gzip body: not configurable (defaults to `public`)

**Listing versions (`GET /api/packages/:name`):**

- Returns all versions (public + unlisted) in the `versions` array
- Each version object includes `visibility: "public" | "unlisted"`
- `latest_version` field always refers to the latest `public` version
- If all versions are unlisted, `latest_version` is `null`

**Searching (`GET /api/search`):**

- Results include only `public` versions
- Unlisted tarballs are not served via search

**Downloading (`GET /api/packages/:name/:version`):**

- Unlisted versions are downloadable via explicit URL (no auth required for public packages; auth required for org-owned private packages)
- Redirect to Supabase Storage tarball URL

**Tags:**

- Unlisted versions automatically receive a `#unlisted` tag on publish (fire-and-forget, same as other tags)
- Users can filter by `#unlisted` tag if they have the link

### UI Changes

- Package page version list shows a "Preview" badge on unlisted versions
- Version dropdown / install instructions always show explicit version syntax for unlisted (`quill install pkg@1.0.0-beta.1`)
- Package settings: owner can toggle visibility of any owned version

---

## 3. Release Gating (Human Approval)

### Goal

Org packages can require human approval before a published version goes live. This lets maintainers review, test, and control what gets released to users.

### Publish Modes

| Mode | Behavior |
|---|---|
| `immediate` (default) | Version goes live instantly after publish |
| `gated` | Version is created in `pending` state, not visible to others until approved |

- For **org packages**: default mode is set at the **org level** (org admin can choose `immediate` or `gated`). Individual packages inherit org default.
- For **user packages**: always `immediate` (no gating).

### Database Changes

**New `releases` table:**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `package_name` | `text` | FK to `packages.name` |
| `version` | `text` | |
| `status` | `text` | `'pending'` / `'approved'` / `'rejected'` / `'cancelled'` |
| `publish_mode` | `text` | `'immediate'` / `'gated'` — how it was published |
| `requested_by` | `uuid` | FK to `auth.users.id` |
| `reviewed_by` | `uuid` | FK to `auth.users.id`, nullable |
| `reviewed_at` | `timestamptz` | nullable |
| `rejection_reason` | `text` | nullable |
| `tarball_url` | `text` | Stored so rejected/pending versions still have the artifact |
| `created_at` | `timestamptz` | default `now()` |

**Unique constraint:** `(package_name, version)` on `releases` table.

**`package_versions` table — add column:**

| Column | Type | Notes |
|---|---|---|
| `release_id` | `uuid` | FK to `releases.id`, nullable |

### Publish Flow

**Immediate (`publish_mode = "immediate"`):**
1. Publisher calls `PUT /api/packages/:name/:version` with `publish_mode: "immediate"` (or omitting it)
2. Version is created directly — goes live instantly
3. `release_id` is `null` for immediate publishes (no approval record needed)

**Gated (`publish_mode = "gated"`):**
1. Publisher calls `PUT /api/packages/:name/:version` with `publish_mode: "gated"`
2. Version is created with `visibility = 'unlisted'` and a `release` record with `status = 'pending'`
3. Publisher receives `201` with `{ status: "pending", message: "Awaiting approval" }`
4. Webhook `release.pending` fired
5. Version **not** returned in public version lists or search until approved

**Approval:**
1. Org admin (or package admin) calls `POST /api/packages/:name/:version/approve`
2. `release.status` → `'approved'`
3. `package_versions.visibility` → `'public'` (if it was `unlisted` for gating)
4. Webhook `release.approved` fired
5. Version now appears in search and as `latest` if semver-maximal

**Rejection:**
1. Org admin calls `POST /api/packages/:name/:version/reject` with `{ reason: "..." }`
2. `release.status` → `'rejected'`, `rejection_reason` set
3. Version stays invisible (unlisted)
4. Webhook `release.rejected` fired
5. Publisher can see rejection reason via `GET /api/packages/:name/releases/:version/status`

### API Endpoints

**List pending releases:**
```
GET /api/packages/:name/releases/pending
```
- Auth: org admin or package admin
- Returns: `[{ version, requested_by, requested_at, publish_mode }]`

**Approve:**
```
POST /api/packages/:name/:version/approve
```
- Auth: org admin or package admin
- Body: `{}`
- Returns: `{ status: "approved", version }`

**Reject:**
```
POST /api/packages/:name/:version/reject
```
- Auth: org admin or package admin
- Body: `{ reason: "Bug in the API" }`
- Returns: `{ status: "rejected", reason }`

**Get release status (for publisher):**
```
GET /api/packages/:name/:version/status
```
- Auth: publisher or org admin
- Returns: `{ status, reviewed_by, reviewed_at, rejection_reason }` (or `not_found` if immediate publish)

**Set org default publish mode:**
```
PUT /api/orgs/:slug/settings
```
- Body: `{ default_publish_mode: "gated" | "immediate" }`
- Auth: org admin
- Affects new packages; existing packages keep their individual setting

**Per-package publish mode override:**
```
PUT /api/packages/:name/settings
```
- Body: `{ publish_mode: "gated" | "immediate" | "inherit" }`
- Auth: org admin
- `inherit` = use org default

### Webhook Events

| Event | Trigger |
|---|---|
| `release.pending` | Gated publish submitted |
| `release.approved` | Admin approves |
| `release.rejected` | Admin rejects |

Payload shape:
```json
{
  "package": "@org/pkg",
  "version": "1.0.0",
  "status": "pending",
  "requested_by": "user-uuid",
  "org_id": "org-uuid"
}
```

### Audit Log

- `release.request` — logged when gated publish submitted
- `release.approve` — logged on approval
- `release.reject` — logged on rejection

---

## 4. Monorepo Support

### Goal

Allow publishing multiple packages in a single `quill publish` invocation, when the user's project contains multiple Ink packages (a workspace/monorepo). Lectern's backend accepts a batch and processes each package independently through the existing publish pipeline.

### API Design

**Endpoint:**
```
POST /api/monorepo/publish
```

**Request body:**
```json
{
  "packages": [
    {
      "name": "@org/foo",
      "version": "1.0.0",
      "visibility": "public",
      "publish_mode": "immediate",
      "tarball_base64": "<gzip tarball encoded as base64>",
      "description": "...",
      "readme": "...",
      "author": "...",
      "license": "MIT",
      "tags": ["utils"]
    },
    {
      "name": "@org/bar",
      "version": "2.0.0",
      "visibility": "unlisted",
      "publish_mode": "gated",
      "tarball_base64": "...",
      "description": null,
      "readme": null,
      "author": null,
      "license": null,
      "tags": []
    }
  ]
}
```

**Constraints:**
- Max 50 packages per request
- Each package individually rate-limited (30/min per package, same as single publish)
- Auth: single token — user must have publish permission on all packages
- If any package fails ownership check, entire batch fails with 403
- Partial success is allowed: if package 1 succeeds and package 2 fails validation (e.g., bad name format), package 1 is still published

**Response:**
```json
{
  "published": [
    { "name": "@org/foo", "version": "1.0.0", "status": "published" },
    { "name": "@org/bar", "version": "2.0.0", "status": "pending" }
  ],
  "failed": [
    { "name": "@org/baz", "version": "3.0.0", "error": "Version already exists" }
  ]
}
```

**HTTP status:**
- `207 Multi-Status` if mixed success/failure
- `200` if all succeed
- `400` if entire request is malformed
- `401/403` if auth fails at the batch level

### Backend Processing

1. Validate auth token
2. Validate all package names and versions (format only, not ownership)
3. For each package, run the full publish pipeline:
   - Authz check
   - Rate limit check
   - Tarball upload
   - Version insert (or gated pending insert)
   - Webhook delivery
   - Audit logging
4. Return aggregated results

### What Lectern Does NOT Manage

- Monorepo workspace detection (handled by Ink CLI before calling the API)
- Internal dependency resolution between packages in the same monorepo
- Build ordering or topological sort

---

## Summary of Changes

| Area | Changes |
|---|---|
| Scoped packages | DB: `packages.scope_type`, `packages.scope_id`. API route handles `@scope/pkg`. Authz extended. |
| Unlisted releases | DB: `package_versions.visibility`. Publish accepts `visibility` field. Version list includes visibility. |
| Release gating | New `releases` table. Gated publishes create `pending` release. New approve/reject/status API endpoints. Org-level default publish mode. |
| Monorepo | New `POST /api/monorepo/publish` endpoint. Batch processing with per-package results. |

---

## Out of Scope for v1

- Private packages (hidden from everyone except owner) — visibility is `public` or `unlisted`, not truly private
- Automated CI-based gating (webhook out to external CI, await result)
- Scheduled/repeated publishing
- Bulk transfer of package ownership between orgs
- Package deprecation per-version (currently package-level only)
