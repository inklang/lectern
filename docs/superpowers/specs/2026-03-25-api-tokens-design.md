# Design: API Tokens for Lectern

**Date:** 2026-03-25

## Overview

Add scoped, long-lived API tokens for CI/CD pipelines and integrations that need access beyond what the CLI token model provides. API tokens differ from CLI tokens in several key ways:

- **CLI tokens** (existing): SHA-256 hashed, used by `quill login`, scoped to a user, used for package publishing via the CLI
- **API tokens** (new): configurable scopes/permissions, optional expiration, optional rate limits, meant for programmatic access from CI/CD, scripts, and third-party integrations

Model follows GitHub Personal Access Tokens and npm Automation Tokens patterns.

---

## 1. Purpose and Use Cases

### Use Cases

- **CI/CD publishing**: Automated pipelines publish packages on merge to main
- **Third-party integrations**: External services ( Renovate, Dependabot) fetch private package metadata
- **Scripted operations**: Bulk publish or manage packages from scripts
- **Read-only access**: Monitoring tools that only need to read package metadata
- **Org automation**: Scripts that manage org membership, teams, webhooks

### Comparison to CLI Tokens

| | CLI Token | API Token |
|---|---|---|
| Scope | Full user access | Granular, configurable |
| Expiry | Never | Optional (1h, 1d, 7d, 30d, never) |
| Rate limiting | No | Optional (10, 100, 1000 req/min) |
| Use case | Local CLI auth | CI/CD, integrations, scripts |
| UI | Shown once on creation | Listed + revocable in UI |

---

## 2. Token Types and Scopes

### Token Types

Tokens are categorized by their highest-level scope:

| Type | Description |
|---|---|
| `read` | Read-only access to public and org-private packages |
| `publish` | Read access + ability to publish new versions |
| `org:manage` | Full org management (members, teams, settings) |
| `admin` | Full user access including token management |

### Scope Flags

Each token has a set of boolean flags that define its permissions:

```typescript
interface TokenScopes {
  // Package operations
  packages_read: boolean      // Read package metadata, versions, downloads
  packages_publish: boolean   // Publish new package versions
  packages_delete: boolean    // Delete packages (org only, requires admin)

  // Org operations
  orgs_read: boolean         // Read org metadata, members, teams
  orgs_manage: boolean        // Manage org settings, members, invites
  orgs_delete: boolean       // Delete organizations (owner only)

  // Team operations
  teams_read: boolean        // Read team memberships, permissions
  teams_manage: boolean      // Create/update/delete teams

  // Token management
  tokens_read: boolean       // List own tokens (never shows secret)
  tokens_write: boolean      // Create/revoke own tokens
}
```

### Scope Prefixes

For convenience, scopes can be grouped with prefixes in the UI:

| Prefix | Expands to |
|---|---|
| `packages:*` | All packages_* scopes |
| `orgs:*` | All orgs_* scopes |
| `teams:*` | All teams_* scopes |
| `*` | All scopes (admin) |

### Rate Limits

Tokens can optionally have rate limiting:

| Limit | Description |
|---|---|
| `10/min` | Suitable for monitoring tools |
| `100/min` | Default for most integrations |
| `1000/min` | High-throughput CI pipelines |
| No limit | Bypass rate limiting (requires `admin` scope) |

---

## 3. Data Model

### New `api_tokens` Table

```sql
create table api_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users not null,
  name            text not null,                  -- user-provided label, e.g. "GitHub Actions"
  token_hash      text unique not null,           -- SHA-256 hash of raw token
  token_prefix    text not null,                  -- first 8 chars for identification (e.g. "lectern_abc123")

  -- Scoping
  scopes          jsonb not null default '{}',    -- see TokenScopes above
  token_type      text not null,                  -- 'read', 'publish', 'org:manage', 'admin'

  -- Rate limiting
  rate_limit      integer,                        -- requests per minute, null = unlimited
  rate_limit_burst integer default 10,           -- burst allowance

  -- Expiration
  expires_at      timestamptz,                    -- null = never expires

  -- Metadata
  description     text,                          -- optional user note
  last_used_at    timestamptz,
  last_used_ip    text,
  created_at      timestamptz default now(),

  -- Org association (optional, for org-scoped tokens)
  org_id          uuid references orgs on delete cascade,
  constraint org_or_user check (org_id is not null or user_id is not null)
);
```

### Indexes

```sql
create index on api_tokens (user_id);
create index on api_tokens (org_id);
create index on api_tokens (token_hash);
create index on api_tokens (expires_at) where expires_at is not null;
```

### Changes to Existing Tables

None. API tokens are additive.

---

## 4. Token Generation

### Format

Raw tokens use the format: `lectern_<base64url_random_32bytes>`

Example: `lectern_Kx9aBcDeFgHiJkLmNoPqRsTuVwXyZ012345`

This gives:
- `lectern_` prefix for identification
- 43 characters of URL-safe base64 (32 bytes)
- Human-readable prefix `lectern_abc123` shown in UI

### Hashing

Same as CLI tokens: SHA-256 hash stored in `token_hash`. The raw token is only shown once at creation time.

---

## 5. API Endpoints

### `POST /api/tokens`

Create a new API token. User must be authenticated.

**Request:**
```json
{
  "name": "GitHub Actions",
  "description": "CI pipeline for inklang/inklang repo",
  "scopes": {
    "packages_read": true,
    "packages_publish": true,
    "packages_delete": false,
    "orgs_read": true,
    "orgs_manage": false,
    "orgs_delete": false,
    "teams_read": true,
    "teams_manage": false,
    "tokens_read": true,
    "tokens_write": true
  },
  "expiresIn": 86400 * 30,  // seconds, null = never
  "rateLimit": 100,         // requests per minute, null = unlimited
  "orgId": null             // optional org scope
}
```

**Response `201`:**
```json
{
  "id": "uuid",
  "name": "GitHub Actions",
  "token": "lectern_Kx9aBcDeFgHiJkLmNoPqRsTuVwXyZ012345",
  "tokenPrefix": "lectern_abc1",
  "scopes": { ... },
  "expiresAt": "2026-04-25T00:00:00Z",
  "rateLimit": 100,
  "createdAt": "2026-03-25T00:00:00Z"
}
```

The raw `token` is only returned at creation time. It cannot be retrieved again.

**Errors:**
- `400` Invalid scopes combination (e.g., `packages_delete` without `packages_publish`)
- `400` `org_manage`/`org_delete` requires org membership with owner/admin role
- `401` Not authenticated

---

### `GET /api/tokens`

List all API tokens for the authenticated user. Never includes the `token_hash` or full `token`.

**Response `200`:**
```json
{
  "tokens": [
    {
      "id": "uuid",
      "name": "GitHub Actions",
      "tokenPrefix": "lectern_abc1",
      "scopes": { ... },
      "tokenType": "publish",
      "expiresAt": "2026-04-25T00:00:00Z",
      "rateLimit": 100,
      "lastUsedAt": "2026-03-24T12:00:00Z",
      "createdAt": "2026-03-25T00:00:00Z"
    }
  ]
}
```

---

### `GET /api/tokens/:id`

Get details for a specific token.

**Response `200`:** Single token object (same shape as list items).

**Errors:**
- `404` Token not found or not owned by user

---

### `DELETE /api/tokens/:id`

Revoke a token immediately.

**Response `204**:** No body.

**Errors:**
- `404` Token not found or not owned by user

---

### `POST /api/tokens/verify` (Internal)

Verify an API token and return its scopes and identity. Used internally by other API routes.

**Request Header:** `Authorization: Bearer <token>`

**Response `200`:**
```json
{
  "valid": true,
  "userId": "uuid",
  "orgId": null,
  "scopes": { ... },
  "tokenType": "publish",
  "rateLimit": 100
}
```

**Response `401`:**
```json
{
  "valid": false,
  "error": "Token expired" | "Token not found" | "Token revoked"
}
```

---

### `GET /api/orgs/:slug/tokens`

List all API tokens for an org. Requires `orgs_manage` scope on a valid org token OR org owner/admin membership.

**Response `200`:**
```json
{
  "tokens": [
    {
      "id": "uuid",
      "name": "GitHub Actions",
      "userId": "uuid",       -- creator of token
      "userEmail": "user@example.com",
      "tokenPrefix": "lectern_abc1",
      "scopes": { ... },
      "expiresAt": null,
      "lastUsedAt": "2026-03-24T12:00:00Z",
      "createdAt": "2026-03-25T00:00:00Z"
    }
  ]
}
```

---

### `DELETE /api/orgs/:slug/tokens/:id`

Revoke an org-scoped token. Requires `orgs_manage` scope or org owner/admin membership.

**Response `204`:**

---

## 6. Authorization Model

### Token Resolution Flow

When a request comes in with `Authorization: Bearer <token>`:

1. Extract raw token from header
2. Hash with SHA-256
3. Look up `api_tokens` row by `token_hash`
4. If not found: return `401 Token not found`
5. If `expires_at` is set and in past: return `401 Token expired`
6. If `org_id` is set: verify user is org member with required scope
7. Update `last_used_at` and `last_used_ip` (fire and forget)
8. Return resolved identity with scopes

### Scope Checking Middleware

Each API route declares required scopes:

```typescript
// Example middleware usage
const scopes = requireScopes(['packages_publish'])

export const POST: APIRoute = async ({ request }) => {
  const { userId, orgId, scopes } = await authenticate(request)
  if (!scopes.packages_publish) {
    return new Response('Forbidden', { status: 403 })
  }
  // ... handle publish
}
```

### Scope Hierarchy

Higher-level scopes imply lower-level ones:

- `admin` implies all scopes
- `org:manage` implies `orgs_read`, `orgs_manage`, `teams_read`, `teams_manage`, `packages_read`
- `publish` implies `packages_read`, `packages_publish`

### Org-Scoped Tokens

Tokens with `org_id` set are scoped to that org:

- They can only access resources within that org
- They cannot be used to manage the user's personal tokens
- Org owners/admins can list and revoke org-scoped tokens

---

## 7. Rate Limiting

### Implementation

Rate limiting uses a sliding window counter per token, stored in Redis (or Supabase edge function with KV).

Key format: `ratelimit:<token_id>:<window_timestamp>`

### Rate Limit Headers

All API responses include:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1679760000
```

### Exceeded Rate Limit Response

```
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1679760030

{"error": "Rate limit exceeded. Retry after 30 seconds."}
```

---

## 8. Frontend UI

### Profile Page: API Tokens Section

Add a new "API Tokens" section below the existing "CLI Tokens" section on `/profile`.

**UI Elements:**
- Section heading: "api tokens"
- List of tokens (token name, prefix, type badge, last used, expiry)
- "New token" button opens creation modal
- Each row has "Copy token" and "Revoke" buttons

**Token Row:**
```
[Token Icon] GitHub Actions
lectern_abc1… · publish · expires in 30d
Last used 2h ago
[Copy] [Revoke]
```

### Create Token Modal

Fields:
- **Name** (required): Text input, max 64 chars
- **Description** (optional): Textarea, max 256 chars
- **Scopes**: Checkbox list grouped by category
  - Packages: Read, Publish, Delete
  - Orgs: Read, Manage, Delete
  - Teams: Read, Manage
  - Tokens: Read, Write
- **Expiration**: Dropdown — 1 hour, 1 day, 7 days, 30 days, Never
- **Rate limit**: Dropdown — 10/min, 100/min, 1000/min, Unlimited
- **Org scope**: Dropdown (if user is org member) — None, or list of orgs

**Preview:**
Shows the effective token type based on selected scopes.

### Token Reveal

When a token is created, show the raw token in a reveal box (same pattern as CLI tokens):

```
Save this token — it won't be shown again.

[lectern_Kx9aBcDeFgHiJkLmNoPqRsTuVwXyZ012345] [Copy]

Use it in your CI/CD pipeline:
export LECTERN_TOKEN=lectern_Kx9aBcDeFgHiJkLmNoPqRsTuVwXyZ012345
```

---

## 9. Security Considerations

### Token Storage

- Raw tokens are never stored — only SHA-256 hash
- Token hash is unique-indexed
- Tokens displayed with prefix only (e.g., `lectern_abc1…`)

### Token Transmission

- Tokens should only be transmitted over HTTPS
- API responses never include the raw token after creation
- Rate limit prevents brute-force attacks on token enumeration

### Expiration

- Default expiration: 30 days
- Org-scoped tokens: max 90 days (configurable by org owner)
- Admin tokens: max 1 year
- Expired tokens are rejected at verification time

### Scope Validation

- Tokens cannot grant scopes they don't have
- Deleting a token immediately invalidates it
- If a user's org membership is removed, org-scoped tokens become invalid

### Audit Logging

Token creation and revocation should be logged to the audit log:

```typescript
logAuditEvent({
  userId: token.user_id,
  action: 'token.create',  // or 'token.revoke'
  resourceType: 'api_token',
  resourceId: token.id,
  details: {
    tokenName: token.name,
    tokenPrefix: token.token_prefix,
    scopes: token.scopes,
    orgId: token.org_id,
    expiresAt: token.expires_at,
  }
})
```

---

## 10. Out of Scope

- Token rotation (user must revoke and recreate)
- IP allowlisting for tokens
- Scoped tokens with package-level granularity (beyond read/publish/admin)
- Token sharing between users
- Biometric or MFA protection for token creation
- Audit log viewer in UI (already in roadmap)

---

## 11. Migration

New migration file: `supabase/migrations/002_api_tokens.sql`

```sql
-- API Tokens table
create table api_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users not null,
  name            text not null,
  token_hash      text unique not null,
  token_prefix    text not null,
  scopes          jsonb not null default '{}',
  token_type      text not null check (token_type in ('read', 'publish', 'org:manage', 'admin')),
  rate_limit      integer,
  rate_limit_burst integer default 10,
  expires_at      timestamptz,
  description     text,
  last_used_at    timestamptz,
  last_used_ip    text,
  created_at      timestamptz default now(),
  org_id          uuid references orgs on delete cascade
);

-- Indexes
create index on api_tokens (user_id);
create index on api_tokens (org_id);
create index on api_tokens (token_hash);
create index on api_tokens (expires_at) where expires_at is not null;

-- RLS
alter table api_tokens enable row level security;

-- Users can CRUD their own tokens
create policy "own api_tokens only"
  on api_tokens for all
  using (auth.uid() = user_id);

-- Org admins can list/revoke org-scoped tokens
create policy "org admins manage org tokens"
  on api_tokens for select, delete
  using (
    org_id is not null and
    exists (
      select 1 from org_members
      where org_id = api_tokens.org_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
    )
  );
```

---

## 12. Library Functions

New file: `src/lib/api-tokens.ts`

```typescript
import { createHash, randomBytes } from 'crypto'

export interface TokenScopes {
  packages_read: boolean
  packages_publish: boolean
  packages_delete: boolean
  orgs_read: boolean
  orgs_manage: boolean
  orgs_delete: boolean
  teams_read: boolean
  teams_manage: boolean
  tokens_read: boolean
  tokens_write: boolean
}

export interface ApiToken {
  id: string
  user_id: string
  name: string
  token_prefix: string
  scopes: TokenScopes
  token_type: 'read' | 'publish' | 'org:manage' | 'admin'
  rate_limit: number | null
  expires_at: string | null
  description: string | null
  last_used_at: string | null
  created_at: string
  org_id: string | null
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function generateRawToken(): string {
  const bytes = randomBytes(32)
  return 'lectern_' + bytes.toString('base64url')
}

export function extractPrefix(raw: string): string {
  // Return first 12 chars: "lectern_" (8) + first 4 of payload
  return raw.slice(0, 12)
}

export function determineTokenType(scopes: TokenScopes): 'read' | 'publish' | 'org:manage' | 'admin' {
  if (scopes.tokens_write && scopes.orgs_delete) return 'admin'
  if (scopes.orgs_manage || scopes.teams_manage) return 'org:manage'
  if (scopes.packages_publish) return 'publish'
  return 'read'
}

export async function issueApiToken(
  userId: string,
  name: string,
  scopes: TokenScopes,
  options?: {
    description?: string
    expiresIn?: number | null
    rateLimit?: number | null
    orgId?: string | null
  }
): Promise<{ token: ApiToken; raw: string }> {
  const { supabase } = await import('./supabase.js')

  const raw = generateRawToken()
  const hash = hashToken(raw)
  const prefix = extractPrefix(raw)
  const tokenType = determineTokenType(scopes)
  const expiresAt = options?.expiresIn
    ? new Date(Date.now() + options.expiresIn * 1000).toISOString()
    : null

  const { data, error } = await supabase
    .from('api_tokens')
    .insert({
      user_id: userId,
      name,
      token_hash: hash,
      token_prefix: prefix,
      scopes,
      token_type: tokenType,
      expires_at: expiresAt,
      rate_limit: options?.rateLimit ?? null,
      description: options?.description ?? null,
      org_id: options?.orgId ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return { token: data, raw }
}

export async function resolveApiToken(raw: string): Promise<{
  userId: string | null
  orgId: string | null
  scopes: TokenScopes | null
  tokenType: string | null
  rateLimit: number | null
  tokenId: string | null
} | null> {
  const { supabase } = await import('./supabase.js')
  const hash = hashToken(raw)
  const now = new Date().toISOString()

  const { data } = await supabase
    .from('api_tokens')
    .select('id, user_id, org_id, scopes, token_type, rate_limit, expires_at')
    .eq('token_hash', hash)
    .single()

  if (!data) return null
  if (data.expires_at && data.expires_at < now) return null

  return {
    userId: data.user_id,
    orgId: data.org_id,
    scopes: data.scopes,
    tokenType: data.token_type,
    rateLimit: data.rate_limit,
    tokenId: data.id,
  }
}

export async function revokeApiToken(tokenId: string, userId: string): Promise<boolean> {
  const { supabase } = await import('./supabase.js')
  const { error } = await supabase
    .from('api_tokens')
    .delete()
    .eq('id', tokenId)
    .eq('user_id', userId)
  return !error
}

export async function listApiTokens(userId: string): Promise<ApiToken[]> {
  const { supabase } = await import('./supabase.js')
  const { data } = await supabase
    .from('api_tokens')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  return data ?? []
}
```
