# Changelog / Diff View — Design Spec

**Date:** 2026-03-25
**Status:** Draft

---

## Overview

The changelog/diff view lets users compare any two versions of a package and see what changed. It is accessed from the package detail page (`/packages/[name]`) and renders a side-by-side or unified diff of the three mutable fields: `dependencies` (JSONB), `readme` (text), and `description`.

---

## Fields to Diff

| Field       | Storage Format          | Diff Strategy                                      |
|-------------|-------------------------|----------------------------------------------------|
| `dependencies` | `Record<string, string>` (JSONB) | JSON deep-diff: added, removed, changed keys   |
| `readme`    | `string` (Markdown)     | Line-by-line text diff (unified format)           |
| `description` | `string \| null`       | Line-by-line text diff, null treated as empty string |

The `author`, `license`, `tarball_url`, and `published_at` fields are immutable for a given version and are never diffed.

---

## URL & Navigation

**URL pattern:** `/packages/[name]/diff?v1=[version]&v2=[version]`

If `v1` or `v2` is omitted, the page renders a version selector prompt instead of the diff output. If only one is provided, default the missing one to the latest version for `v2` and the second-latest for `v1`.

The versions list on the main package page (`/packages/[name]`) gains a "Compare" button on each row (or a checkbox multi-select). Clicking "Compare" with two selected versions navigates to the diff URL.

---

## UI: Version Selector

### Inline Multi-Select (on `/packages/[name]`)

- Each version row in the existing `.versions-list` gains a checkbox (left of the version string).
- A sticky footer bar appears when 2 versions are checked: `[ Compare versions vA → vB ]`.
- Checking more than 2 deselects the oldest selection.
- The footer is hidden when fewer than 2 versions are selected.

### Diff Page (`/packages/[name]/diff`)

**Layout:** Two-column on desktop, stacked on mobile.

```
┌──────────────────────────────────────────────────────┐
│  [v1 selector ▾]  →  [v2 selector ▾]    [Swap]       │
├──────────────────────────────────────────────────────┤
│  DESCRIPTION                                          │
│  + added line                                         │
│  - removed line                                       │
├──────────────────────────────────────────────────────┤
│  DEPENDENCIES                                         │
│  + inklang/http (added)                               │
│  ~ inklang/router: "1.0.0" → "1.1.0" (changed range) │
│  - inklang/old-dep (removed)                         │
├──────────────────────────────────────────────────────┤
│  README                                               │
│  (unified diff with +/- line markers)                 │
└──────────────────────────────────────────────────────┘
```

### Diff Style Conventions

- **Added lines/keys:** green background `#22c55e20`, green text `#16a34a`
- **Removed lines/keys:** red background `#ef444420`, red text `#dc2626`
- **Changed keys (deps only):** amber background `#f59e0b20`, amber text `#d97706`
- **Unchanged context:** default text color, no background
- **Section headers:** `font-mono`, uppercase, `letter-spacing: 0.1em`, `color: var(--muted)`

---

## Diff Algorithms

### Dependencies (JSONB)

1. Load both version rows from `package_versions` by `(package_name, version)`.
2. Parse `dependencies` as `Record<string, string>`.
3. Compute three sets:
   - **Added:** keys in `v2` not in `v1`
   - **Removed:** keys in `v1` not in `v2`
   - **Changed:** keys in both where `v1[key] !== v2[key]`
4. Render as a sorted list, grouped: Added → Changed → Removed.

### Readme (Text)

1. Fetch `readme` from both versions (can be null).
2. Treat null as empty string.
3. Run a line-by-line LCS diff (same algorithm as `diff` utility or `htmldiff-js`).
4. Output unified diff format: context lines (unchanged) + add/remove markers.
5. For very long files (>500 lines), collapse unchanged regions into `... N lines hidden ...` blocks, keeping add/remove regions visible.

### Description

Same algorithm as readme, but rendered in a single block without collapsing (descriptions are short by design).

---

## Performance: On-Request vs Pre-Stored

**Decision: On-request computation.**

Rationale:
- Diffs are read infrequently — most users view the latest version only.
- The total number of versions per package is small in practice (package registries rarely have thousands of versions per package).
- Pre-storing diffs adds storage overhead and complexity for a write operation on every publish.
- On-request diffs for packages with many versions (e.g., 100+) can be addressed with caching headers (see below).

**Caching strategy:**
- The diff page sets `Cache-Control: private, max-age=3600` on responses.
- For packages with >20 versions, lazy-load the diff on the client after the page renders, rather than computing it server-side during the initial page load.
- Alternatively, a `?refresh=true` query param busts the cache for users who need the latest data.

**Database load:**
- The diff page makes at most 2 `package_versions` SELECT queries (one per version). This is identical to the load already incurred by the main package page.
- No new database tables or indexes are required.

---

## API Endpoint (Optional Enhancement)

For programmatic access (CI/CD tooling), add:

`GET /api/packages/[name]/diff?v1=[version]&v2=[version]`

Returns JSON:
```json
{
  "v1": "1.0.0",
  "v2": "1.1.0",
  "description": { "added": [], "removed": [], "changed": [] },
  "dependencies": { "added": [], "removed": [], "changed": [] },
  "readme": { "diff": "...unified diff string..." }
}
```

This can reuse the same diff computation logic as the page, just serialized to JSON instead of HTML.

---

## Edge Cases

### Major Version Jumps (many changes)

- If `readme` diff exceeds 500 changed lines, collapse unchanged context regions.
- Show a banner: "This diff is large. Showing changed regions only. [Show full diff]".
- Full diff loads on demand (client-side toggle).

### Identical Versions

- If `v1 === v2`, show a friendly message: "These versions are identical." with a link back to the package page.

### Version Not Found

- If either `v1` or `v2` does not exist for this package, return a 404 with a message: "Version X.X.X not found for package Y."

### Null Readme / Description

- Treat null as empty string. An empty diff (no changes) is rendered as a note: "No readme / description recorded for this version."

### Single-Version Package

- If the package has only one version, the "Compare" UI is hidden entirely on the package page.
- Direct navigation to `/diff?v1=...&v2=...` with the same version on both sides shows the "identical" message.

### Same Version Compared to Itself

- Detect `v1 === v2` and short-circuit with the identical message instead of computing a diff.

---

## File Locations

| File                                    | Purpose                                           |
|------------------------------------------|---------------------------------------------------|
| `src/pages/packages/[name]/diff.astro`   | Diff view page                                    |
| `src/lib/diff.ts`                        | Shared diff computation (deps, text, description) |
| `src/pages/api/packages/[name]/diff.ts`  | Optional JSON API endpoint                        |

---

## Milestones

1. **Core diff logic** (`src/lib/diff.ts`): JSON deep-diff for deps, line-diff for text.
2. **Diff page** (`src/pages/packages/[name]/diff.astro`): Full UI with version selectors.
3. **Inline compare UI** on main package page: checkboxes + compare footer.
4. **API endpoint** (optional): JSON diff for CI/CD use.
