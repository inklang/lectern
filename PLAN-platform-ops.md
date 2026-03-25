# Plan: Platform Ops - Webhooks, RSS, Rate Limiting, Audit Log

## Feature Description

Four platform operations features: webhooks on publish events, RSS/Atom feed, rate limiting, and audit logging.

## Implementation Phases

### Phase 1: Webhooks
1. Create migration `009_webhooks.sql`:
   - Create `webhook_configs` table:
     - `id`, `org_id` (nullable for system-wide), `url`, `events` (text[]), `secret`, `active`, `created_at`
   - RLS policies: org admins can manage; public read for active webhooks
2. Create `src/lib/webhooks.ts`:
   - `deliverWebhook(orgId, event, payload)` function
   - HMAC-SHA256 signature generation using webhook secret
   - Retry logic (3 retries with backoff)
3. Hook into `PUT /api/packages/[name]/[version]`:
   - After successful publish, call `deliverWebhook` with `package.published` event
4. Add webhook management API:
   - `GET /api/orgs/[slug]/webhooks`
   - `POST /api/orgs/[slug]/webhooks`
   - `PUT /api/orgs/[slug]/webhooks/[id]`
   - `DELETE /api/orgs/[slug]/webhooks/[id]`
5. Add webhook management UI in org settings

### Phase 2: RSS/Atom Feed
1. Create `src/pages/api/feed.xml.ts`:
   - Return Atom feed of recently published packages
   - Use `pubDate` and author fields
   - Pagination via `?page=2` and `<link rel="next">`
2. Create `src/pages/feed.xml.astro`:
   - Server-rendered Atom feed at `/feed.xml`
3. Include in sitemap or homepage link

### Phase 3: Rate Limiting
1. Create migration `010_rate_limits.sql`:
   - Create `rate_limits` table:
     - `id`, `user_id` (nullable for anon), `token_id` (nullable), `endpoint_pattern`, `window_start`, `request_count`
   - Index on `(user_id, token_id, endpoint_pattern, window_start)`
2. Create `src/lib/ratelimit.ts`:
   - `checkRateLimit(userId?, tokenId?, endpoint, limit, windowSeconds)` function
   - Returns `{ allowed: boolean, remaining: number, resetAt: Date }`
   - Uses sliding window counter
3. Create middleware for API routes:
   - Apply to write endpoints (publish, org management)
   - Different limits: anonymous vs authenticated, vs token-based
4. Return `X-RateLimit-*` headers on all API responses
5. Return `429 Too Many Requests` when limit exceeded

### Phase 4: Audit Log
1. Create migration `011_audit_log.sql`:
   - Create `audit_log` table:
     - `id`, `org_id` (nullable), `user_id`, `token_id` (nullable), `action`, `resource_type`, `resource_id`, `details` (jsonb), `ip_address`, `user_agent`, `created_at`
   - Indexes on `(org_id, created_at)`, `(user_id, created_at)`, `action`
   - RLS: org admins can read their org logs; users can read their own
2. Create `src/lib/audit.ts`:
   - `logAuditEvent(event)` function
   - `queryAuditLog(filters)` function
3. Hook into all write operations:
   - Package publish/unpublish
   - Org/team/member changes
   - Token creation/deletion
   - Invite creation/acceptance
4. Add audit log UI in org settings:
   - `GET /api/orgs/[slug]/audit` endpoint
   - Audit log viewer page at `/orgs/[slug]/settings/audit`

## Critical Files
- `src/lib/webhooks.ts` (new)
- `src/lib/ratelimit.ts` (new)
- `src/lib/audit.ts` (new)
- `src/pages/api/packages/[name]/[version].ts` - hook in webhook + audit
- `src/pages/api/feed.xml.ts` (new)
- `src/pages/api/orgs/[slug]/webhooks/[id].ts` (new)
- `src/pages/orgs/[slug]/settings/audit.astro` (new)

## Dependencies
- Phase 1 (webhooks) can start independently
- Phase 4 (audit) should be done after orgs/teams is complete

## Complexity
Medium (all phases)
