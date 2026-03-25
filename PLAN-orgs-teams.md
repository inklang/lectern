# Plan: Orgs + Teams with Per-Package Permissions and Invite Links

## Feature Description

Complete the org/team system with missing DELETE endpoints, member management UI, team management UI, and invite management.

## Current State (already implemented)

- Full database schema: `orgs`, `org_members`, `org_teams`, `org_team_members`, `org_package_permissions`, `org_invites`
- Core API endpoints for org/team CRUD and invite generation
- `canUserPublish()` permission checks with team-based per-package permissions
- Frontend pages for creating orgs, viewing org detail, and org settings

## Gaps to Implement

### Phase 1: Missing API Endpoints
1. DELETE `/api/orgs/[slug]` - delete an org (owner only)
2. DELETE `/api/orgs/[slug]/invites/[token]` - cancel pending invite
3. GET `/api/orgs/[slug]/invites` - list all pending invites
4. PUT `/api/orgs/[slug]/members/[userId]` - update member role
5. DELETE `/api/orgs/[slug]/members/[userId]` - remove member
6. DELETE `/api/orgs/[slug]/teams/[teamId]` - delete a team
7. PUT `/api/orgs/[slug]/teams/[teamId]` - update team name

### Phase 2: Authorization - Read Permission Check
1. Add `canUserRead(packageName)` to `src/lib/authz.ts` following `canUserPublish` pattern
2. Use in package read endpoints

### Phase 3: Org Settings UI Enhancements
1. Member management section in `/orgs/[slug]/settings/index.astro`
2. Team management section in `/orgs/[slug]/settings/teams/index.astro`
3. Invite management UI (list/cancel invites)

### Phase 4: Profile Page
1. Show user's orgs on profile page

## Critical Files
- `src/lib/orgs.ts` - core logic layer
- `src/lib/authz.ts` - permission checks
- `src/pages/api/orgs/[slug]/index.ts`
- `src/pages/orgs/[slug]/settings/index.astro`

## Complexity
Medium
