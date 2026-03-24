# Design: Lectern — Supabase Migration, Auth, Package Details & Hybrid Search

**Date:** 2026-03-24

## Overview

Four interconnected changes to lectern and quill:

1. **Full Supabase migration** — replace flat-file storage with Supabase Postgres + Storage
2. **Supabase Auth** — GitHub OAuth for web UI; browser-callback flow for `quill login`
3. **Package details** — `description` field in `ink-package.toml` + `README.md` rendered on package page
4. **Hybrid search** — full-text (Postgres `tsvector`) + semantic (NVIDIA NIM embeddings + pgvector)

---

## 1. Data Model

### Supabase Tables

**`packages`** — one row per package name, holds ownership
```sql
create table packages (
  name       text primary key,
  owner_id   uuid references auth.users not null,
  created_at timestamptz default now()
);
```

**`package_versions`** — one row per name@version
```sql
create table package_versions (
  package_name  text references packages(name) not null,
  version       text not null,
  description   text,
  readme        text,                          -- raw markdown from README.md in tarball
  dependencies  jsonb default '{}',
  tarball_url   text not null,                 -- Supabase Storage public URL
  published_at  timestamptz default now(),
  embedding     vector(1024),                  -- nvidia/nv-embedqa-e5-v5, input_type: passage
  primary key (package_name, version)
);

-- full-text search index
alter table package_versions
  add column fts tsvector
  generated always as (
    to_tsvector('english', coalesce(package_name, '') || ' ' || coalesce(description, ''))
  ) stored;

create index on package_versions using gin(fts);
create index on package_versions using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

**`cli_tokens`** — long-lived tokens issued to `quill login`
```sql
create table cli_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  token_hash  text unique not null,   -- sha256 of raw token; raw token never stored
  created_at  timestamptz default now(),
  last_used   timestamptz
);
```

### Supabase Storage

One bucket: `tarballs`. Object path: `{package_name}/{version}.tar.gz`.

- Public read (anyone can download)
- Authenticated write (publish only with valid CLI token)

### RLS Policies

- `packages`: anyone can SELECT; INSERT requires `auth.uid() = owner_id`
- `package_versions`: anyone can SELECT; INSERT requires caller owns the parent package
- `cli_tokens`: users can only see/delete their own tokens

### `index.json` compatibility

`GET /index.json` continues to work — it reads from Supabase and returns the same shape as before so existing `quill install` clients are unaffected.

---

## 2. Auth

### Web (lectern)

Supabase Auth with GitHub OAuth provider. `/login` page triggers `supabase.auth.signInWithOAuth({ provider: 'github' })`. Session managed by Supabase client library via cookie.

### CLI — `quill login`

1. CLI generates a random 32-byte token (`crypto.randomBytes(32).toString('hex')`)
2. Starts a temporary HTTP server on a random available port (chosen dynamically via `net.createServer` + `server.listen(0)`)
3. Opens browser to `https://lectern.inklang.org/cli-auth?callback=http://localhost:{PORT}/callback` where `{PORT}` is the dynamically assigned port
4. User logs in with GitHub on lectern
5. Lectern stores `sha256(token)` in `cli_tokens`, associates with `auth.uid()`
6. Lectern redirects to `http://localhost:9876/callback?token=<raw>&username=<github_username>`
7. CLI captures token + username, writes to `~/.quillrc`, shuts down local server
8. Terminal prints: `Logged in as <github_username>`

**`~/.quillrc` new shape:**
```json
{
  "token": "<raw 64-char hex token>",
  "username": "github-username",
  "registry": "https://lectern.inklang.org"
}
```

Old `privateKey` / `publicKey` fields are removed. `quill logout` deletes `~/.quillrc` and calls `DELETE /api/auth/token` to revoke server-side.

**`DELETE /api/auth/token`** — revoke the current CLI token.
- Request: `Authorization: Bearer <token>` header, no body
- Lectern computes `sha256(token)`, deletes the matching row from `cli_tokens`
- Response: `204 No Content` on success, `401` if token not found

### `quill publish` auth

Sends `Authorization: Bearer <token>` header. Lectern:
1. Computes `sha256(token)`, looks up `cli_tokens`
2. Gets `user_id`, updates `last_used`
3. Checks `packages.owner_id = user_id` (or package doesn't exist yet → first publish sets ownership)

---

## 3. Package Details

### `ink-package.toml` — new `description` field

```toml
name = "ink.mobs"
version = "0.3.1"
description = "Mob lifecycle and combat grammar for Ink."
main = "mod"

[dependencies]
# ...

[grammar]
entry = "src/grammar.ts"
output = "dist/grammar.ir.json"

[runtime]
jar = "runtime/build/libs/ink.mobs-0.3.1.jar"
entry = "ink.mobs.InkMobsRuntime"
```

- `description` is optional (max 200 chars). Omitting it is valid.
- Read by `quill publish` and sent to the registry alongside the tarball.

### README extraction

`quill publish` checks for a `README.md` in the package root. If present, its content is read and sent as a multipart field alongside the tarball upload. Lectern stores the raw markdown in `package_versions.readme`.

The lectern package detail page renders the README using `marked`. The resulting HTML is sanitized with `sanitize-html` (Node-compatible) before rendering to prevent XSS. `DOMPurify` is browser-only and requires `jsdom` in Node — `sanitize-html` is the correct server-side choice.

### Package page changes

- Short description appears below the version badge in the page header
- README section rendered below the install snippet
- Package cards on `/packages` show description as a subtitle line

---

## 4. Hybrid Search

### Embedding on publish

When a package version is published, lectern generates an embedding:

```
input = "{name} {description} {readme_plaintext}"
POST https://integrate.api.nvidia.com/v1/embeddings
  model: "nvidia/nv-embedqa-e5-v5"
  input_type: "passage"
```

Stored in `package_versions.embedding vector(1024)`. Requires `NVIDIA_API_KEY` env var. If the API call fails, publish still succeeds — embedding is left null and the package is excluded from semantic results until re-indexed.

### Search endpoint

`GET /api/search?q=<query>` — returns up to 20 results.

Both queries filter to the latest version per package using a subquery:
```sql
-- reusable CTE used in both queries
with latest as (
  select distinct on (package_name) package_name, version, description, fts, embedding
  from package_versions
  order by package_name, published_at desc
)
```

**Step 1 — full-text:**
```sql
select package_name, ts_rank(fts, query) as rank
from latest, plainto_tsquery('english', $1) query
where fts @@ query
order by rank desc
limit 20
```

**Step 2 — semantic:**
Embed the query (`input_type: "query"`), then:
```sql
select package_name, 1 - (embedding <=> $1) as similarity
from latest
where embedding is not null
order by similarity desc
limit 20
```
If the NVIDIA API is unavailable at query time, the semantic step is skipped and results are returned from full-text only.

**Step 3 — RRF merge:**
```
score(doc) = 1/(k + rank_fulltext) + 1/(k + rank_semantic)   where k = 60
```
Results from both lists are merged, deduplicated by `package_name`, sorted by RRF score, top 20 returned.

**Response shape:**
```json
[
  { "name": "ink.mobs", "version": "0.3.1", "description": "...", "score": 0.94 }
]
```

### Search UI

Search bar at the top of `/packages`. Debounced (300ms) fetch to `/api/search?q=...`. Results replace the package list inline — no separate search page. Empty query shows all packages (existing behavior).

---

## 5. Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `SUPABASE_URL` | lectern | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | lectern | Service role key (bypasses RLS for server-side ops) |
| `SUPABASE_ANON_KEY` | lectern (client) | Anon key for Auth flows |
| `NVIDIA_API_KEY` | lectern | NIM embedding API |
| `BASE_URL` | lectern | Used in tarball URLs (e.g. `https://lectern.inklang.org`) |

`STORAGE_DIR` and `LECTERN_TOKENS` are removed (replaced by Supabase).

---

## 6. Removed / Deprecated

- `src/store.ts` — replaced by Supabase client calls
- `src/auth.ts` — `validateToken` / `loadTokens` removed (static bearer tokens gone)
- `src/pages/api/auth/register.ts` — keypair registration removed
- `~/.quillrc` `privateKey` / `publicKey` / `fingerprint` fields
- `src/util/keys.ts` in quill — `fingerprint()`, `readRc()`, `writeRc()` replaced or rewritten

---

## 7. Out of Scope

- Package transfer / ownership handoff UI
- Package deletion or yanking
- `quill new` changes (separate spec)
- Re-index script (nice to have, post-launch)
- Rate limiting on search/publish
- Multiple auth providers (GitHub only for now)
