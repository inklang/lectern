# Package Security: Integrity & Vulnerability Scanning

**Date:** 2026-03-30
**Status:** Approved

## Overview

Two complementary security systems for Lectern:

1. **Package Integrity** — SHA-256 hashing at publish time, lock file on install, hash verification by the CLI and on the package page.
2. **Vulnerability Scanning** — dependency advisory checking at publish time, surfaced as warnings or publish blocks, with a cache for efficient page rendering.

These are independent systems. Integrity has no dependency on scanning; scanning has no dependency on integrity.

---

## System 1: Package Integrity

### Goal

Detect tampering between what was published to the registry and what a client installs. Covers CDN/storage tampering and compromised mirrors.

### Schema change

Add one nullable column to `package_versions`:

```sql
alter table package_versions add column tarball_hash text;
```

The value is a lowercase hex-encoded SHA-256 digest prefixed `sha256:` — e.g. `sha256:a3f9c2...`. Nullable so existing rows without hashes remain valid; the CLI treats a missing hash as unverified rather than an error.

### Publish flow

In `PUT /api/packages/[name]/[version]`, hash computation is the **first** step after `tarballData` is fully read — before `uploadTarball`, before any gated/non-gated branching:

1. Compute `sha256(tarballData)` using Node's built-in `crypto.createHash('sha256')`.
2. If hash computation fails, return 500 and abort. The tarball must not reach storage without a hash.
3. Pass `tarball_hash` into `insertVersion` (normal path) or into the `releases` row insert (gated path).

Keeping hash computation before `uploadTarball` preserves the invariant: if we cannot hash, we cannot store.

**Gated publish path**: the gated branch creates a `releases` row and returns 202 before `insertVersion` is called. The migration adds `tarball_hash text` to `releases`. When a gated release is approved and promoted to `package_versions`, the hash is copied from `releases` — not recomputed.

### Metadata API

`GET /api/packages/[name]` (implemented in `src/pages/api/packages/[name]/index.ts`) serializes version rows to an explicit response object. Add `tarball_hash` to that serialization. This endpoint is public; the hash is returned for all packages (consistent with the tarball itself being publicly downloadable via redirect).

### CLI verification flow

1. CLI calls `GET /api/packages/[name]` → receives version list, each entry includes `tarball_hash`.
2. CLI calls `GET /api/packages/[name]/[version]` → follows redirect, receives tarball bytes.
3. CLI computes SHA-256 of received bytes, compares to registry hash.
4. Mismatch → abort install with error: `integrity check failed for owner/pkg@version: expected sha256:abc, got sha256:xyz`. CLI cleans up any partially-extracted files before exiting.
5. Missing hash → install with warning: `no integrity hash for owner/pkg@version (published before integrity was enabled)`. No lock file entry is written — there is no hash to record. On subsequent installs, the CLI re-fetches and warns again.

### Lock file (`ink.lock`)

Written to the project root after a successful install. One entry per resolved dependency:

```
mintychochip/ink-paper@1.2.0 sha256:a3f9c2...
other-pkg@0.3.1 sha256:b81fd4...
```

**Package identifier format**: matches `package_versions.package_name` exactly — `owner/pkg` for user-scoped packages (slash separator), bare name for unscoped packages. The publish handler enforces that package name segments contain only `[a-zA-Z0-9_-]` — no slashes in unscoped names, no `@` prefix. The `@version` suffix uses `@` as a delimiter; this is unambiguous because package names never contain `@`.

**Version**: the exact resolved version string (e.g. `1.2.0`), not a range. Version resolution (how a range becomes a specific version) is a CLI concern, out of scope for this spec.

On subsequent installs:
- Entry exists, hash matches → trust, skip registry call.
- Entry exists, hash differs → abort (tamper detected). CLI cleans up partial extraction.
- No entry → fetch from registry, verify, append to lock file.

The lock file is committed to source control for reproducible builds.

### Package page

Both `src/pages/[user]/[slug].astro` (SSR detail page) and `src/pages/packages/[name].astro` (redirect/legacy page) may need updating depending on which renders the version metadata. The hash should appear in a "Details" or "Security" section as a copyable monospace string. No new API call needed — the hash is in the version data already fetched for the page.

### Error handling

- Hash computation failure at publish → 500, publish aborted.
- Hash mismatch at install → hard abort; CLI cleans up partial extraction.
- Missing hash (legacy) → install with warning, no lock entry, warning repeats on future installs.

---

## System 2: Vulnerability Scanning

### Goal

Warn publishers when their package depends on packages with known security advisories. Block publishes with critical/high severity matches; warn on medium/low.

### Dependencies

`semver` is a **required** dependency for this feature. There is no fallback. If `semver` throws, `scanDependencies` propagates the error to the publish-time catch handler, which logs and skips scanning (publish proceeds). Treating unavailability as a skip rather than a hard failure ensures scanning never makes publishing unreliable.

### Data model

The existing `package_advisories` table, including all current columns:

```
id                uuid primary key
package_name      text not null
advisory_id       text not null        -- external identifier (e.g. GHSA-xxxx)
cve               text
severity          text not null        -- 'low' | 'medium' | 'high' | 'critical'
affected_versions text not null        -- semver range, e.g. "<1.2.0"
fixed_version     text
title             text not null
advisory_url      text not null
source            text not null default 'manual'
fetched_at        timestamptz
published_at      timestamptz
unique(package_name, advisory_id)
```

The `POST /api/advisories` request body must include all `not null` fields: `package_name`, `advisory_id`, `severity`, `affected_versions`, `title`, `advisory_url`.

Add one new table for the scan cache:

```sql
create table package_vulnerability_cache (
  package_name    text not null,
  version         text not null,
  advisory_id     uuid not null references package_advisories(id) on delete cascade,
  severity        text not null,
  dep_name        text not null,
  dep_range       text not null,  -- version range string from dependencies JSONB
  cached_at       timestamptz default now(),
  primary key (package_name, version, advisory_id)
);
```

`dep_range` stores the declared dependency range (e.g. `>=1.0.0 <2.0.0`), not a resolved version. The advisory check is against the declared range, not a specific installed version. The package page shows the declared range so users understand which versions of the dep may be affected.

**Advisory deletion behaviour**: when an advisory row is deleted, its cache rows are cascade-deleted. No re-scan is triggered on deletion — the live fallback on the package page (described below) covers the gap for any affected package pages. This is acceptable; false negatives during advisory removal are preferable to stale false positives.

### Scanning logic (`src/lib/security.ts`)

Single exported function:

```ts
scanDependencies(deps: Record<string, string>): Promise<VulnerabilityHit[]>
```

`deps` is the `dependencies` JSONB from `package_versions` — keys are package names, values are **version range strings** (e.g. `">=1.0.0 <2.0.0"`).

The function:
1. Queries `package_advisories` where `package_name` is in the dep keys.
2. For each advisory, checks whether the dep's version range overlaps the advisory's `affected_versions` using `semver.intersects(depRange, affectedRange)`. A non-empty intersection means the dep could resolve to an affected version.
3. Returns hits: `{ dep, depRange, advisory }`.

Conservative by design: flags when a vulnerable version is _possible_ given the declared range. Publishers whose range excludes all affected versions are not flagged.

Pure and testable — no side effects beyond the DB read.

### At publish time

Hash computation and vulnerability scanning both run **before** `uploadTarball` and before the gated/non-gated branch point. Order: hash → scan → upload/branch.

1. Call `scanDependencies(dependencies)`.
2. Any `critical` or `high` hits → return `422 Unprocessable Entity`. Publish is blocked regardless of gated mode. The tarball has not been uploaded at this point.
3. Any `medium` or `low` hits → publish proceeds, response includes a `warnings` array.
4. Scan throws → log, skip, proceed with publish.

422 response body:

```json
{
  "error": "publish blocked: dependencies have known vulnerabilities",
  "vulnerabilities": [
    {
      "dep": "some/package",
      "depRange": ">=1.0.0 <1.1.0",
      "advisory": {
        "id": "...",
        "advisoryId": "GHSA-xxxx",
        "cve": "CVE-2025-1234",
        "severity": "high",
        "title": "...",
        "affectedVersions": "<1.1.0",
        "fixedVersion": "1.1.0",
        "advisoryUrl": "..."
      }
    }
  ]
}
```

### Package page

`getPackageAdvisories(dbSlug)` already fetches direct advisories. Extend the page to also read from `package_vulnerability_cache` for the current version's `package_name` + `version`. Show a banner:

> ⚠ 1 dependency has a high severity advisory — [view details]

Expanding the banner shows dep name, declared range, advisory title, CVE, and link.

**Live fallback**: if no cache rows exist for the current version (pre-scanning package or cleared cache), call `scanDependencies` live using the version's `dependencies` JSONB. Wrap in `.catch(() => [])` so page load never fails due to scanning. This ensures the banner is never permanently missing.

### Re-scan on new advisory (`POST /api/advisories`)

After the advisory row is inserted, trigger an async background re-scan:

1. Query all `package_versions` rows where `dependencies` JSONB contains the advisory's `package_name` as a key. This is a broad pre-filter — non-intersecting ranges are filtered out by `semver.intersects` inside `scanDependencies`.
2. For each matching version, run `scanDependencies` and upsert results into `package_vulnerability_cache`.
3. Fire-and-forget (do not await before returning 201). Log failures to console. If the re-scan fails silently, the live fallback on each package page still surfaces the advisory on next load.

Re-scan is not triggered on advisory deletion — see Advisory deletion behaviour above.

### Admin advisory API

`POST /api/advisories` — requires a valid API token with `token_type = 'admin'`, verified via `verifyApiToken` from `src/lib/api-tokens.ts`. Return 403 if the token is missing, invalid, or not `admin` type. Body must include all required `package_advisories` fields (see Data model above).

### Error handling

- `scanDependencies` throws → log and skip, publish proceeds.
- Re-scan failure → logged; live fallback covers the gap on page load.
- Advisory delete → cache cleared by cascade; live fallback covers the gap until any new advisory triggers a fresh cache entry.

---

## Files changed

| File | Change |
|------|--------|
| `supabase/migrations/025_package_security.sql` | Add `tarball_hash` to `package_versions`; add `tarball_hash` to `releases`; add `package_vulnerability_cache` table |
| `src/lib/security.ts` | New — `scanDependencies()` |
| `src/pages/api/packages/[name]/[version].ts` | Compute hash and call `scanDependencies` before `uploadTarball` and before gated branch |
| `src/pages/api/packages/[name]/index.ts` | Include `tarball_hash` in GET response serialization |
| `src/pages/[user]/[slug].astro` | Show hash in details section; show vulnerability dep banner with live fallback |
| `src/pages/api/advisories.ts` | Add POST handler (admin-only via `verifyApiToken`) + async cache refresh |

## Out of scope

- Automated advisory feeds (OSV, GitHub Advisory DB) — follow-up after manual system is proven.
- Package signing (Ed25519) — follow-up after hashing is adopted.
- CLI version resolution algorithm — how ranges are resolved to exact versions is a CLI concern.
- CLI partial-install cleanup — the spec specifies the invariant (clean on abort); implementation is a CLI concern.
- Gated-publish approval flow internals — the spec requires `tarball_hash` on the `releases` row and copy-on-promotion; the rest of the gated flow is unchanged.
