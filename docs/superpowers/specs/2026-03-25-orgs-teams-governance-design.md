# Orgs/Teams — Governance + Package Transfer Design

## Overview

This spec extends the existing orgs/teams implementation with two additions:

1. **Granular delete vs. publish permissions** — `write` no longer implies delete; delete is its own action requiring `admin` on the package.
2. **Package transfer** — a distinct `transfer` action allowing packages to move between users and orgs, carrying over existing team permissions.

Org roles (owner/admin/member) remain purely organizational. There is no role-override hierarchy at the team level.

---

## 1. Permission Model

### Actions

Each action maps to a column in `org_package_permissions` or a check in `canUserPublish` / `canUserDelete`.

| Action | Description | Who can perform it |
|--------|-------------|-------------------|
| `read` | View package metadata, download versions | Team members with `read`, `write`, or `admin`; org members by default |
| `publish` | Publish a new version | Team members with `write` or `admin` on the package |
| `delete` | Delete a specific version or the entire package | Team members with `admin` on the package |
| `transfer` | Transfer package to a different owner (user or org) | Org admins for cross-org transfers; team admins for same-org transfers |

### Column naming

The `org_package_permissions` table has columns `read`, `write`, `admin`. The UI/API surface uses the term `publish` for what the DB column calls `write`. No column rename is required at this stage — the mapping is handled in the API layer.

### Explicit vs. implied permissions

- `write` → `publish` (DB: `write` = true)
- `admin` → `publish` + `delete` + `transfer` within the team
- `org_admin` → `transfer` for any package in the org, cross-org included
- `owner` → all actions on all org packages

There is no override hierarchy. Org roles define what a user *can* do; team permissions define what they *may* do per package. A team cannot grant more permissions than the org role allows, but the team cannot restrict an org role's baseline either.

---

## 2. API Changes

### 2.1 Publish — check `publish` flag

**Endpoint:** `POST /api/packages/[name]/publish`

**Before:** Auth check used `write` flag from `org_package_permissions`.
**After:** Auth check uses `publish` flag (DB column `write`). `admin` still implies publish.

### 2.2 Delete — new `delete` flag

**Endpoint:** `DELETE /api/packages/[name]`

**Before:** Required `write` on the package.
**After:** Requires `delete` flag (i.e., `admin` on the package). Returns 403 if the user has `write` but not `delete`.

### 2.3 Transfer — new endpoint

**Endpoint:** `PUT /api/packages/[name]/transfer`

**Request body:**
```json
{
  "target": {
    "type": "user" | "org",
    "id": "uuid-of-user-or-org"
  },
  "targetName": "new-package-name"  // optional; defaults to current name
}
```

**Authorization:**
- Same-org transfer (transferring to a different user or org within the same parent): requires `admin` on the package
- Cross-org transfer: requires org-level admin role on the source org

**Response (200):**
```json
{
  "package": { ...updated package record... },
  "transfer": {
    "from": { "type": "org", "id": "..." },
    "to": { "type": "user", "id": "..." },
    "at": "2026-03-25T12:00:00Z",
    "by": "user-uuid"
  }
}
```

**Error responses:**
- `403` — user lacks transfer permission
- `404` — package or target owner not found
- `409` — target already has a package with `targetName`

### 2.4 Permission update — add `delete`

**Endpoint:** `PUT /api/orgs/[slug]/teams/[name]/packages/[pkg]/permission`

**Request body:**
```json
{
  "read": true,
  "write": true,
  "admin": false
}
```

The `admin` flag now controls `delete` and `transfer` within the team scope. A team lead with `admin: true` can grant/revoke read and write (publish) to other team members on that package, but cannot transfer the package across orgs — only org admins can do that.

---

## 3. Database Changes

### 3.1 New column on `org_package_permissions`

```sql
ALTER TABLE org_package_permissions ADD COLUMN delete boolean NOT NULL DEFAULT false;
```

### 3.2 New `package_transfers` table

```sql
CREATE TABLE package_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  from_owner_type text NOT NULL,  -- 'user' or 'org'
  from_owner_id uuid NOT NULL,
  to_owner_type text NOT NULL,
  to_owner_id uuid NOT NULL,
  to_package_name text NOT NULL,
  initiated_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE package_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_can_view_transfers"
  ON package_transfers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = from_owner_id
      AND org_members.user_id = auth.uid()
      AND org_members.role IN ('admin', 'owner')
    )
    OR auth.uid() = initiated_by
  );
```

### 3.3 RLS on `org_package_permissions` for `delete`

The existing RLS policies on `org_package_permissions` already restrict updates to org admins and team leads. No new RLS policies needed — the `delete` column is protected by the same policies that protect `write`.

### 3.4 Cascade behavior

When a package is transferred, all rows in `org_package_permissions` for that package remain intact. If the destination org does not have teams matching the stored `team_id` values, those permissions become orphaned — visible in the org settings UI but inactive.

---

## 4. UI Changes

### 4.1 Package Settings — Permissions Matrix

On the package settings page, display a matrix:

| Team | Read | Publish | Delete |
|------|------|---------|--------|
| frontend | [x] | [x] | [ ] |
| backend | [x] | [ ] | [ ] |

Each cell is a checkbox. Changes save immediately via `PUT /api/orgs/[slug]/teams/[name]/packages/[pkg]/permission`.

Only users with `admin` on the package can modify this matrix.

### 4.2 Package Settings — Transfer Section

Below the permissions matrix, a "Transfer Package" section:

- **Visible to:** users with `transfer` permission on the package
- **Content:** A dropdown to select target type (user / org), a text input for target ID or slug, an optional field for new package name.
- **Confirmation step:** Modal with text: "This will transfer `package-name` to `target`. Team permissions will be carried over. This action cannot be undone." + confirm button.

### 4.3 Org Settings — Transferred Packages Section

In the destination org's settings, a section "Packages from Other Orgs" listing all packages owned by the org where `owner_type` is `user` (i.e., transferred from a user) or where the previous owner differs from the current org.

Each entry shows:
- Package name
- Original owner
- Transfer date
- A warning icon if the package has team permissions referencing teams that don't exist in the current org (orphaned permissions)

---

## 5. Edge Cases

### 5.1 Package name collision on transfer

If the target owner already has a package with `targetName`, return `409 Conflict`. The transfer is not partial — it does not overwrite or rename the existing package.

### 5.2 Transfer to self

If the target owner is the same as the current owner (same user or same org), return `400 Bad Request` with message "Package is already owned by this user/org."

### 5.3 Deleting a team that has package permissions

Deleting a team does not cascade to `org_package_permissions`. The rows remain with a reference to a `team_id` that no longer exists. These are orphaned permissions. The UI should display them as such. This is consistent with the existing design and avoids data loss on team deletion.

### 5.4 Transfer a package that is already being transferred

No concurrent transfer locking is implemented at this stage. The last write wins. A future enhancement could add a `transferring_to` column on `packages` with a status enum.

### 5.5 User deletes own account with org-owned packages

If a user who owns packages is deleted, those packages must be transferred to an org or another user before the deletion proceeds. This is enforced at the API level — the user deletion endpoint returns `409` if the user has packages with `owner_type = 'user'` and no mechanism exists to handle orphaned packages.

---

## 6. File Map

### Modified files

- `supabase/migrations/003_orgs.sql` — add `delete` column to `org_package_permissions`
- `supabase/migrations/014_package_transfers.sql` — new migration for `package_transfers` table
- `src/lib/orgs.ts` — add `transferPackage`, `getPackageTransferLog`, `getOrphanedPackagePermissions` functions
- `src/lib/authz.ts` — add `canUserDelete`, `canUserTransfer` checks; update `canUserPublish` to use `publish`/`write` flag
- `src/pages/api/packages/[name]/publish.ts` — check `publish` flag instead of `write`
- `src/pages/api/packages/[name]/index.ts` — add `PUT` handler for transfer
- `src/pages/api/packages/[name]/delete.ts` — check `delete` flag
- `src/pages/api/orgs/[slug]/teams/[name]/packages/[pkg]/permission.ts` — handle `delete` flag in permission updates
- `src/pages/packages/[name].astro` — add transfer button and permissions matrix UI

### New files

- `supabase/migrations/014_package_transfers.sql`
- `src/pages/api/packages/[name]/transfer.ts` — `PUT /api/packages/[name]/transfer`
- `src/pages/api/orgs/[slug]/packages/transferred.ts` — `GET /api/orgs/:slug/packages/transferred`

---

## 7. Out of Scope

- Billing, subscriptions, paid tiers
- Automatic team name mapping on transfer
- Override hierarchy (org role restricted by team permissions)
- Concurrent transfer locking
- Cross-org team permission sync
- SSO / SCIM
