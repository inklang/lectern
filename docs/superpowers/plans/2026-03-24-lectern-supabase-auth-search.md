# Lectern — Supabase Migration, Auth, Package Details & Hybrid Search

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate lectern from flat-file storage to Supabase, replace keypair auth with GitHub OAuth + CLI token flow, add package descriptions + README rendering, and add hybrid full-text + semantic search.

**Architecture:** Supabase Postgres holds all package metadata and ownership; Supabase Storage holds tarballs. A thin `src/lib/` layer wraps all Supabase calls. Astro SSR API routes delegate to lib functions. Quill CLI auth is rewritten to use a browser-callback token flow.

**Tech Stack:** Astro SSR (Node), `@supabase/supabase-js`, `marked`, `sanitize-html`, `vitest` (lectern tests), TypeScript (both lectern + quill)

**Spec:** `docs/superpowers/specs/2026-03-24-lectern-supabase-search-auth-design.md`

---

## File Map

### Lectern — new files
- `supabase/migrations/001_initial.sql` — schema: packages, package_versions (with fts + pgvector), cli_tokens
- `supabase/migrations/002_search_fn.sql` — `match_package_versions` pgvector RPC function
- `src/lib/supabase.ts` — Supabase client singleton (service key + anon key exports)
- `src/lib/db.ts` — all Postgres query functions (getPackage, listPackages, registerVersion, etc.)
- `src/lib/storage.ts` — tarball upload/download via Supabase Storage
- `src/lib/tokens.ts` — CLI token hash/verify helpers
- `src/lib/embed.ts` — NVIDIA NIM embedding client
- `src/lib/search.ts` — hybrid search: FTS + semantic + RRF merge
- `src/lib/markdown.ts` — marked + sanitize-html pipeline
- `src/pages/cli-auth.astro` — GitHub OAuth callback page that issues CLI token and redirects to localhost callback
- `src/pages/api/auth/token.ts` — `DELETE` handler to revoke CLI token
- `src/pages/api/search.ts` — `GET /api/search?q=` endpoint

### Lectern — modified files
- `src/pages/api/packages/[name]/[version].ts` — rewrite: Supabase auth + storage
- `src/pages/index.json.ts` — rewrite: read from Supabase instead of store.ts
- `src/pages/packages/[name].astro` — add description + README rendering
- `src/pages/packages/index.astro` — add search bar + description on cards
- `src/pages/index.astro` — add description on recent package cards
- `astro.config.mjs` — no change needed

### Lectern — deleted files
- `src/store.ts`
- `src/auth.ts`
- `src/pages/api/auth/register.ts`

### Quill — modified files
- `src/util/keys.ts` — remove keypair/fingerprint logic; add `readToken()`, `writeToken()`, `clearToken()`
- `src/commands/login.ts` — rewrite: browser callback flow (local HTTP server + open browser)
- `src/commands/publish.ts` — update: Bearer token auth; send description + README multipart

### Test files (new)
- `src/lib/search.test.ts` (lectern) — RRF merge unit tests
- `src/lib/embed.test.ts` (lectern) — NVIDIA client unit tests (mocked fetch)
- `src/lib/tokens.test.ts` (lectern) — token hash/verify unit tests
- `src/lib/markdown.test.ts` (lectern) — sanitization unit tests

---

## Chunk 1: Supabase Setup + Schema + DB Layer

### Task 1: Install dependencies and configure Vitest in lectern

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] Install Supabase client and test tooling:
  ```bash
  cd lectern
  npm install @supabase/supabase-js marked sanitize-html
  npm install --save-dev vitest @types/sanitize-html
  ```

- [ ] Add test script to `package.json`:
  ```json
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
  ```

- [ ] Create `vitest.config.ts`:
  ```ts
  import { defineConfig } from 'vitest/config'

  export default defineConfig({
    test: {
      environment: 'node',
    },
  })
  ```

- [ ] Verify install:
  ```bash
  npm test
  ```
  Expected: `No test files found` (not an error, just nothing to run yet)

- [ ] Commit:
  ```bash
  git add package.json package-lock.json vitest.config.ts
  git commit -m "chore: add supabase-js, marked, sanitize-html, vitest"
  ```

---

### Task 2: Write the Supabase schema migration

**Files:**
- Create: `supabase/migrations/001_initial.sql`

- [ ] Create `supabase/migrations/001_initial.sql`:
  ```sql
  -- Enable pgvector
  create extension if not exists vector;

  -- Packages table: one row per package name, holds ownership
  create table packages (
    name       text primary key,
    owner_id   uuid references auth.users not null,
    created_at timestamptz default now()
  );

  -- Package versions table
  create table package_versions (
    package_name  text references packages(name) not null,
    version       text not null,
    description   text,
    readme        text,
    dependencies  jsonb default '{}',
    tarball_url   text not null,
    published_at  timestamptz default now(),
    embedding     vector(1024),
    primary key (package_name, version)
  );

  -- Full-text search generated column
  alter table package_versions
    add column fts tsvector
    generated always as (
      to_tsvector('english', coalesce(package_name, '') || ' ' || coalesce(description, ''))
    ) stored;

  create index on package_versions using gin(fts);
  create index on package_versions using ivfflat (embedding vector_cosine_ops) with (lists = 100);

  -- CLI tokens table
  create table cli_tokens (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references auth.users not null,
    token_hash  text unique not null,
    created_at  timestamptz default now(),
    last_used   timestamptz
  );

  -- RLS
  alter table packages enable row level security;
  alter table package_versions enable row level security;
  alter table cli_tokens enable row level security;

  -- packages: public read, owner write
  create policy "public read packages"
    on packages for select using (true);
  create policy "owner insert packages"
    on packages for insert with check (auth.uid() = owner_id);

  -- package_versions: public read, owner write
  create policy "public read versions"
    on package_versions for select using (true);
  create policy "owner insert versions"
    on package_versions for insert
    with check (
      exists (
        select 1 from packages
        where name = package_name and owner_id = auth.uid()
      )
    );

  -- cli_tokens: user can only see/delete their own
  create policy "own tokens only"
    on cli_tokens for all using (auth.uid() = user_id);
  ```

  > Apply this migration manually in the Supabase dashboard SQL editor, or via `supabase db push` if the CLI is set up.

- [ ] Also create the `tarballs` storage bucket manually in the Supabase dashboard:
  - Bucket name: `tarballs`
  - Public: ✅ (public read)
  - File size limit: 50MB

- [ ] Commit:
  ```bash
  git add supabase/
  git commit -m "feat: add supabase schema migration"
  ```

---

### Task 3: Supabase client singleton

**Files:**
- Create: `src/lib/supabase.ts`

- [ ] Create `src/lib/supabase.ts`:
  ```ts
  import { createClient } from '@supabase/supabase-js'

  const url = process.env['SUPABASE_URL']
  const serviceKey = process.env['SUPABASE_SERVICE_KEY']
  const anonKey = process.env['SUPABASE_ANON_KEY']

  if (!url || !serviceKey || !anonKey) {
    throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_KEY, or SUPABASE_ANON_KEY')
  }

  // Service client: bypasses RLS, used server-side for publish/auth operations
  export const supabase = createClient(url, serviceKey)

  // Anon client: used for Auth flows (OAuth sign-in)
  export const supabaseAnon = createClient(url, anonKey)
  ```

- [ ] Commit:
  ```bash
  git add src/lib/supabase.ts
  git commit -m "feat: add supabase client singleton"
  ```

---

### Task 4: DB query functions

**Files:**
- Create: `src/lib/db.ts`

- [ ] Create `src/lib/db.ts`:
  ```ts
  import { supabase } from './supabase.js'

  export interface PackageVersion {
    package_name: string
    version: string
    description: string | null
    readme: string | null
    dependencies: Record<string, string>
    tarball_url: string
    published_at: string
  }

  export interface PackageRow {
    name: string
    owner_id: string
    created_at: string
  }

  // Returns all packages with all their versions (for /index.json)
  export async function listAllPackages(): Promise<Record<string, Record<string, PackageVersion>>> {
    const { data, error } = await supabase
      .from('package_versions')
      .select('*')
      .order('published_at', { ascending: false })
    if (error) throw error

    const result: Record<string, Record<string, PackageVersion>> = {}
    for (const row of data ?? []) {
      if (!result[row.package_name]) result[row.package_name] = {}
      result[row.package_name][row.version] = row
    }
    return result
  }

  // Returns all versions for a single package, sorted newest first
  export async function getPackageVersions(name: string): Promise<PackageVersion[]> {
    const { data, error } = await supabase
      .from('package_versions')
      .select('*')
      .eq('package_name', name)
      .order('published_at', { ascending: false })
    if (error) throw error
    return data ?? []
  }

  // Returns the owner fingerprint (user_id) for a package, or null
  export async function getPackageOwner(name: string): Promise<string | null> {
    const { data } = await supabase
      .from('packages')
      .select('owner_id')
      .eq('name', name)
      .single()
    return data?.owner_id ?? null
  }

  // Registers a new package (first publish)
  export async function createPackage(name: string, ownerId: string): Promise<void> {
    const { error } = await supabase
      .from('packages')
      .insert({ name, owner_id: ownerId })
    if (error) throw error
  }

  // Inserts a new package version row
  export async function insertVersion(version: Omit<PackageVersion, 'published_at'> & { embedding?: number[] | null }): Promise<void> {
    const { error } = await supabase
      .from('package_versions')
      .insert(version)
    if (error) throw error
  }

  // Returns true if name@version already exists
  export async function versionExists(name: string, version: string): Promise<boolean> {
    const { data } = await supabase
      .from('package_versions')
      .select('version')
      .eq('package_name', name)
      .eq('version', version)
      .single()
    return !!data
  }
  ```

- [ ] Commit:
  ```bash
  git add src/lib/db.ts
  git commit -m "feat: add db query functions"
  ```

---

### Task 5: Migrate `/index.json` to read from Supabase

**Files:**
- Modify: `src/pages/index.json.ts`

- [ ] Rewrite `src/pages/index.json.ts`:
  ```ts
  import type { APIRoute } from 'astro'
  import { listAllPackages } from '../../lib/db.js'

  export const GET: APIRoute = async () => {
    const packages = await listAllPackages()
    return new Response(JSON.stringify({ packages }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }
  ```

- [ ] Verify locally (`npm run dev`, hit `/index.json`) — should return `{ packages: {} }` if DB is empty

- [ ] Commit:
  ```bash
  git add src/pages/index.json.ts
  git commit -m "feat: migrate /index.json to supabase"
  ```

---

## Chunk 2: Auth — Lectern Side

### Task 6: Token hash/verify helpers + tests

**Files:**
- Create: `src/lib/tokens.ts`
- Create: `src/lib/tokens.test.ts`

- [ ] Write the failing tests first — create `src/lib/tokens.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { hashToken, verifyToken, extractBearer } from './tokens.js'

  describe('hashToken', () => {
    it('returns a 64-char hex string', () => {
      const hash = hashToken('abc123')
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('is deterministic', () => {
      expect(hashToken('test')).toBe(hashToken('test'))
    })

    it('differs for different inputs', () => {
      expect(hashToken('a')).not.toBe(hashToken('b'))
    })
  })

  describe('verifyToken', () => {
    it('returns true when hash matches', () => {
      const raw = 'mysecrettoken'
      const hash = hashToken(raw)
      expect(verifyToken(raw, hash)).toBe(true)
    })

    it('returns false when hash does not match', () => {
      expect(verifyToken('wrong', hashToken('right'))).toBe(false)
    })
  })

  describe('extractBearer', () => {
    it('extracts token from Authorization header', () => {
      expect(extractBearer('Bearer abc123')).toBe('abc123')
    })

    it('returns null for missing header', () => {
      expect(extractBearer(null)).toBeNull()
    })

    it('returns null for non-Bearer scheme', () => {
      expect(extractBearer('Basic abc123')).toBeNull()
    })
  })
  ```

- [ ] Run tests to verify they fail:
  ```bash
  cd lectern && npm test
  ```
  Expected: `Cannot find module './tokens.js'`

- [ ] Create `src/lib/tokens.ts`:
  ```ts
  import { createHash } from 'crypto'
  import { supabase } from './supabase.js'

  export function hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex')
  }

  export function verifyToken(raw: string, hash: string): boolean {
    return hashToken(raw) === hash
  }

  export function extractBearer(authHeader: string | null): string | null {
    if (!authHeader?.startsWith('Bearer ')) return null
    return authHeader.slice(7)
  }

  // Looks up a CLI token, returns user_id or null. Updates last_used on hit.
  export async function resolveToken(raw: string): Promise<string | null> {
    const hash = hashToken(raw)
    const { data } = await supabase
      .from('cli_tokens')
      .select('user_id, id')
      .eq('token_hash', hash)
      .single()
    if (!data) return null

    // Update last_used (fire and forget)
    supabase.from('cli_tokens').update({ last_used: new Date().toISOString() })
      .eq('id', data.id).then(() => {})

    return data.user_id
  }

  // Stores a new CLI token. Returns the raw token.
  export async function issueToken(userId: string): Promise<string> {
    const { randomBytes } = await import('crypto')
    const raw = randomBytes(32).toString('hex')
    const hash = hashToken(raw)
    const { error } = await supabase
      .from('cli_tokens')
      .insert({ user_id: userId, token_hash: hash })
    if (error) throw error
    return raw
  }

  // Revokes a CLI token by raw value.
  export async function revokeToken(raw: string): Promise<boolean> {
    const hash = hashToken(raw)
    const { error } = await supabase
      .from('cli_tokens')
      .delete()
      .eq('token_hash', hash)
    return !error
  }
  ```

- [ ] Run tests to verify they pass:
  ```bash
  npm test
  ```
  Expected: all 7 tests pass (note: `resolveToken`, `issueToken`, `revokeToken` aren't unit-tested here since they require Supabase — they're covered by integration)

- [ ] Commit:
  ```bash
  git add src/lib/tokens.ts src/lib/tokens.test.ts
  git commit -m "feat: add cli token helpers"
  ```

---

### Task 7: `/cli-auth` page — GitHub OAuth + token issue + redirect

**Files:**
- Create: `src/pages/cli-auth.astro`

This page handles the browser leg of `quill login`. The flow:
1. If no Supabase session: redirect to GitHub OAuth, passing `callback` param through
2. On OAuth return: session established, issue CLI token, redirect to `callback?token=...&username=...`

- [ ] Create `src/pages/cli-auth.astro`:
  ```astro
  ---
  import { supabaseAnon } from '../lib/supabase.js'
  import { issueToken } from '../lib/tokens.js'

  const url = new URL(Astro.request.url)
  const callbackUrl = url.searchParams.get('callback')

  // Step 2: OAuth returned with code — exchange for session
  const code = url.searchParams.get('code')
  if (code) {
    const { data, error } = await supabaseAnon.auth.exchangeCodeForSession(code)
    if (!error && data.session && callbackUrl) {
      const userId = data.session.user.id
      const username = data.session.user.user_metadata?.['user_name'] as string ?? 'unknown'
      const token = await issueToken(userId)
      const redirect = new URL(callbackUrl)
      redirect.searchParams.set('token', token)
      redirect.searchParams.set('username', username)
      return Astro.redirect(redirect.toString())
    }
  }

  // Step 1: No session — kick off GitHub OAuth
  if (!callbackUrl) {
    return new Response('Missing callback parameter', { status: 400 })
  }

  const redirectTo = new URL('/cli-auth', Astro.url.origin)
  redirectTo.searchParams.set('callback', callbackUrl)

  const { data } = await supabaseAnon.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: redirectTo.toString() }
  })

  if (data.url) return Astro.redirect(data.url)
  ---
  <p>Something went wrong. Please try again.</p>
  ```

- [ ] Commit:
  ```bash
  git add src/pages/cli-auth.astro
  git commit -m "feat: add /cli-auth page for quill login browser flow"
  ```

---

### Task 8: `DELETE /api/auth/token` — revoke CLI token

**Files:**
- Create: `src/pages/api/auth/token.ts`
- Delete: `src/pages/api/auth/register.ts`

- [ ] Create `src/pages/api/auth/token.ts`:
  ```ts
  import type { APIRoute } from 'astro'
  import { extractBearer, revokeToken } from '../../../lib/tokens.js'

  export const DELETE: APIRoute = async ({ request }) => {
    const raw = extractBearer(request.headers.get('authorization'))
    if (!raw) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), { status: 401 })
    }

    const ok = await revokeToken(raw)
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Token not found' }), { status: 401 })
    }

    return new Response(null, { status: 204 })
  }
  ```

- [ ] Delete the old keypair registration endpoint:
  ```bash
  rm src/pages/api/auth/register.ts
  ```

- [ ] Commit:
  ```bash
  git add src/pages/api/auth/token.ts
  git rm src/pages/api/auth/register.ts
  git commit -m "feat: add DELETE /api/auth/token; remove keypair register endpoint"
  ```

---

## Chunk 3: Auth — Quill Side

### Task 9: Rewrite `keys.ts` → token helpers

**Files:**
- Modify: `src/util/keys.ts`

- [ ] Replace `src/util/keys.ts` entirely:
  ```ts
  import fs from 'fs'
  import os from 'os'
  import path from 'path'

  const RC_PATH = path.join(os.homedir(), '.quillrc')

  export interface QuillRc {
    token: string
    username: string
    registry: string
  }

  export function readRc(): QuillRc | null {
    try {
      const raw = fs.readFileSync(RC_PATH, 'utf8')
      return JSON.parse(raw) as QuillRc
    } catch {
      return null
    }
  }

  export function writeRc(rc: QuillRc): void {
    fs.writeFileSync(RC_PATH, JSON.stringify(rc, null, 2), { mode: 0o600 })
  }

  export function clearRc(): void {
    try { fs.unlinkSync(RC_PATH) } catch {}
  }
  ```

- [ ] Search for any remaining usages of the old `fingerprint` or `privateKey` exports and fix them:
  ```bash
  grep -r "fingerprint\|privateKey\|publicKey" src/ --include="*.ts"
  ```

- [ ] Commit:
  ```bash
  git add src/util/keys.ts
  git commit -m "feat: replace keypair keys.ts with token-based readRc/writeRc"
  ```

---

### Task 10: Rewrite `quill login` with browser callback flow

**Files:**
- Modify: `src/commands/login.ts`
- Modify: `src/cli.ts` (if login options change)

- [ ] Rewrite `src/commands/login.ts`:
  ```ts
  import http from 'http'
  import net from 'net'
  import { exec } from 'child_process'
  import { readRc, writeRc, clearRc } from '../util/keys.js'

  function openBrowser(url: string): void {
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"`
      : `xdg-open "${url}"`
    exec(cmd)
  }

  function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer()
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address() as net.AddressInfo
        srv.close(() => resolve(addr.port))
      })
      srv.on('error', reject)
    })
  }

  export class LoginCommand {
    async run(): Promise<void> {
      const registry = process.env['QUILL_REGISTRY'] ?? 'https://lectern.inklang.org'
      const port = await getFreePort()
      const callbackUrl = `http://127.0.0.1:${port}/callback`
      const authUrl = `${registry}/cli-auth?callback=${encodeURIComponent(callbackUrl)}`

      console.log(`Opening browser to log in...`)
      console.log(`If the browser doesn't open, visit: ${authUrl}`)
      openBrowser(authUrl)

      const result = await new Promise<{ token: string; username: string }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          server.close()
          reject(new Error('Login timed out after 5 minutes'))
        }, 5 * 60 * 1000)

        const server = http.createServer((req, res) => {
          const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
          const token = url.searchParams.get('token')
          const username = url.searchParams.get('username')

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body><p>Logged in! You can close this tab.</p></body></html>')

          clearTimeout(timeout)
          server.close()

          if (!token || !username) {
            reject(new Error('Missing token or username in callback'))
          } else {
            resolve({ token, username })
          }
        })

        server.listen(port, '127.0.0.1')
      })

      writeRc({ token: result.token, username: result.username, registry })
      console.log(`Logged in as ${result.username}`)
    }
  }

  export class LogoutCommand {
    run(): void {
      const registry = process.env['QUILL_REGISTRY'] ?? 'https://lectern.inklang.org'
      const rc = readRc()  // readRc is statically imported at top of file

      // Best-effort server-side revocation (fire and forget)
      if (rc?.token) {
        fetch(`${registry}/api/auth/token`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${rc.token}` }
        }).catch(() => {})
      }

      clearRc()
      console.log('Logged out.')
    }
  }
  ```

- [ ] Build quill to verify no TypeScript errors:
  ```bash
  cd quill && npm run build 2>&1 | head -30
  ```
  Expected: no errors

- [ ] Commit:
  ```bash
  git add src/commands/login.ts src/util/keys.ts
  git commit -m "feat: rewrite quill login with browser OAuth callback flow"
  ```

---

## Chunk 4: Storage + Publish Migration

### Task 11: Supabase Storage helper

**Files:**
- Create: `src/lib/storage.ts` (lectern)

- [ ] Create `src/lib/storage.ts`:
  ```ts
  import { supabase } from './supabase.js'

  const BUCKET = 'tarballs'

  // Uploads a tarball buffer and returns the public URL
  export async function uploadTarball(packageName: string, version: string, data: Buffer): Promise<string> {
    const objectPath = `${packageName}/${version}.tar.gz`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, data, {
        contentType: 'application/gzip',
        upsert: false,
      })
    if (error) throw error

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(objectPath)
    return urlData.publicUrl
  }

  // Downloads a tarball as a Buffer, or returns null if not found
  export async function downloadTarball(packageName: string, version: string): Promise<Buffer | null> {
    const objectPath = `${packageName}/${version}.tar.gz`
    const { data, error } = await supabase.storage.from(BUCKET).download(objectPath)
    if (error || !data) return null
    return Buffer.from(await data.arrayBuffer())
  }
  ```

- [ ] Commit:
  ```bash
  git add src/lib/storage.ts
  git commit -m "feat: add supabase storage helper"
  ```

---

### Task 12: Rewrite publish API route

**Files:**
- Modify: `src/pages/api/packages/[name]/[version].ts`

The `PUT` route now:
1. Verifies CLI Bearer token → gets `user_id`
2. Checks package ownership in DB
3. Uploads tarball to Supabase Storage
4. Inserts version row into `package_versions`
5. Generates embedding (non-blocking, see Task 16)

The `GET` route now redirects to the Supabase Storage public URL.

- [ ] Rewrite `src/pages/api/packages/[name]/[version].ts`:
  ```ts
  import type { APIRoute } from 'astro'
  import { extractBearer, resolveToken } from '../../../lib/tokens.js'
  import { getPackageOwner, createPackage, insertVersion, versionExists } from '../../../lib/db.js'
  import { uploadTarball } from '../../../lib/storage.js'
  import { extractDependencies } from '../../../tar.js'

  export const GET: APIRoute = async ({ params }) => {
    const { name, version } = params
    if (!name || !version) return new Response('Bad request', { status: 400 })

    // Redirect to Supabase Storage public URL via storage helper
    const { supabase } = await import('../../../lib/supabase.js')
    const { data: urlData } = supabase.storage
      .from('tarballs')
      .getPublicUrl(`${name}/${version}.tar.gz`)
    return Response.redirect(urlData.publicUrl, 302)
  }

  export const PUT: APIRoute = async ({ params, request }) => {
    const { name, version } = params
    if (!name || !version) return new Response('Bad request', { status: 400 })

    // Auth
    const raw = extractBearer(request.headers.get('authorization'))
    if (!raw) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header. Run `quill login` first.' }), { status: 401 })
    }

    const userId = await resolveToken(raw)
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token. Run `quill login`.' }), { status: 401 })
    }

    // Ownership check
    const owner = await getPackageOwner(name)
    if (owner && owner !== userId) {
      return new Response(JSON.stringify({ error: `Package ${name} is owned by a different account` }), { status: 403 })
    }

    // Duplicate check
    if (await versionExists(name, version)) {
      return new Response(JSON.stringify({ error: `${name}@${version} already exists` }), { status: 409 })
    }

    // Parse body — multipart or legacy raw gzip. Do NOT read arrayBuffer() here;
    // it can only be consumed once and is read inside each branch below.
    const contentType = request.headers.get('content-type') ?? ''
  let tarballData: Buffer
  let description: string | null = null
  let readme: string | null = null
  let dependencies: Record<string, string> = {}

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const tarballFile = formData.get('tarball') as File | null
    if (!tarballFile) return new Response(JSON.stringify({ error: 'Missing tarball' }), { status: 400 })
    tarballData = Buffer.from(await tarballFile.arrayBuffer())
    description = (formData.get('description') as string | null) ?? null
    readme = (formData.get('readme') as string | null) ?? null
    try { dependencies = await extractDependencies(tarballData) } catch {}
  } else {
    // Legacy: raw gzip body (backwards compat — remove after one release cycle)
    tarballData = Buffer.from(await request.arrayBuffer())
    if (!tarballData.length) return new Response(JSON.stringify({ error: 'Empty body' }), { status: 400 })
    try { dependencies = await extractDependencies(tarballData) } catch {}
  }

  // Upload to Supabase Storage
  const tarballUrl = await uploadTarball(name, version, tarballData)

  // Create package record on first publish
  if (!owner) await createPackage(name, userId)

  // Insert version row (embedding added async after response)
  await insertVersion({
    package_name: name,
    version,
    description,
    readme,
    dependencies,
    tarball_url: tarballUrl,
    embedding: null,
  })

  // Trigger embedding generation non-blocking — implemented in Task 16
  generateAndStoreEmbedding(name, version, description, readme).catch(() => {})

  const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:4321'
  return new Response(JSON.stringify({ name, version, url: `${baseUrl}/api/packages/${name}/${version}` }), { status: 201 })
  }

  // Placeholder — wired up in Task 16
  async function generateAndStoreEmbedding(
    _name: string, _version: string,
    _description: string | null, _readme: string | null
  ): Promise<void> {}
  ```

- [ ] Verify `extractDependencies` exists — it is already in `src/tar.ts` in the lectern repo. Confirm with:
  ```bash
  grep -n "export.*extractDependencies" src/tar.ts
  ```
  Expected: a matching export line. If missing, check `src/tar.ts` for the correct function name.

- [ ] Delete the old `src/store.ts` and `src/auth.ts`:
  ```bash
  rm src/store.ts src/auth.ts
  ```

- [ ] Build lectern to verify no TypeScript errors:
  ```bash
  npm run build 2>&1 | head -40
  ```

- [ ] Commit:
  ```bash
  git add src/pages/api/packages/ src/lib/
  git rm src/store.ts src/auth.ts
  git commit -m "feat: rewrite publish route to use supabase auth + storage"
  ```

---

### Task 13: Update `quill publish` to use token auth

**Files:**
- Modify: `src/commands/publish.ts` (quill)

- [ ] Read the current `src/commands/publish.ts`:
  ```bash
  cat src/commands/publish.ts
  ```

- [ ] Update the publish auth header section. Find where `x-ink-public-key` / `x-ink-signature` are set and replace with:
  ```ts
  import { readRc } from '../util/keys.js'

  // In the publish method, replace keypair auth with:
  const rc = readRc()
  if (!rc?.token) {
    console.error('Not logged in. Run `quill login` first.')
    process.exit(1)
  }

  // Replace the headers object to use Bearer token:
  headers: {
    'Authorization': `Bearer ${rc.token}`,
    'Content-Type': 'application/gzip',
  }
  ```

- [ ] Build quill to verify no TypeScript errors:
  ```bash
  npm run build 2>&1 | head -30
  ```

- [ ] Commit:
  ```bash
  git add src/commands/publish.ts
  git commit -m "feat: update quill publish to use bearer token auth"
  ```

---

## Chunk 5: Package Details

### Task 14: Description + README extraction in `quill publish`

**Files:**
- Modify: `src/commands/publish.ts` (quill)
- Modify: `src/model/manifest.ts` (quill) — add `description` field

- [ ] Add `description` to `PackageManifest` in `src/model/manifest.ts`:
  ```ts
  // Add to the interface:
  description?: string
  ```

- [ ] Update `src/commands/publish.ts` to send description + README as multipart:
  ```ts
  // Read description from manifest
  const description = manifest.description ?? null

  // Check for README.md in project root
  let readme: string | null = null
  const readmePath = path.join(this.projectDir, 'README.md')
  if (fs.existsSync(readmePath)) {
    readme = fs.readFileSync(readmePath, 'utf8')
  }

  // Build multipart form body
  const boundary = '----QuillPublishBoundary'
  const parts: Buffer[] = []

  // tarball part
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="tarball"; filename="package.tar.gz"\r\nContent-Type: application/gzip\r\n\r\n`
  ))
  parts.push(tarball)
  parts.push(Buffer.from('\r\n'))

  if (description) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${description}\r\n`
    ))
  }

  if (readme) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="readme"\r\n\r\n${readme}\r\n`
    ))
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`))
  const body = Buffer.concat(parts)

  // Update fetch call headers:
  headers: {
    'Authorization': `Bearer ${rc.token}`,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  }
  ```

  > The lectern publish route already handles multipart parsing as written in Task 12 — no further changes needed there. Task 12's PUT handler reads `description` and `readme` from form fields when `Content-Type` is `multipart/form-data`.

- [ ] Build both projects:
  ```bash
  cd quill && npm run build && cd ../lectern && npm run build
  ```

- [ ] Commit:
  ```bash
  # In quill repo:
  git add src/commands/publish.ts src/model/manifest.ts
  git commit -m "feat: send description and readme in quill publish"

  # In lectern repo:
  git add src/pages/api/packages/
  git commit -m "feat: parse description and readme from multipart publish"
  ```

---

### Task 15: Render description + README on package pages

**Files:**
- Create: `src/lib/markdown.ts` (lectern)
- Create: `src/lib/markdown.test.ts` (lectern)
- Modify: `src/pages/packages/[name].astro` (lectern)
- Modify: `src/pages/packages/index.astro` (lectern)
- Modify: `src/pages/index.astro` (lectern)

- [ ] Write failing tests — create `src/lib/markdown.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { renderMarkdown } from './markdown.js'

  describe('renderMarkdown', () => {
    it('converts markdown to HTML', async () => {
      const html = await renderMarkdown('# Hello\n\nWorld')
      expect(html).toContain('<h1>Hello</h1>')
      expect(html).toContain('<p>World</p>')
    })

    it('strips script tags', async () => {
      const html = await renderMarkdown('<script>alert(1)</script>')
      expect(html).not.toContain('<script>')
    })

    it('strips onclick attributes', async () => {
      const html = await renderMarkdown('<a onclick="evil()">click</a>')
      expect(html).not.toContain('onclick')
    })

    it('returns empty string for null input', async () => {
      const html = await renderMarkdown(null)
      expect(html).toBe('')
    })
  })
  ```

- [ ] Run tests to verify they fail:
  ```bash
  npm test
  ```
  Expected: `Cannot find module './markdown.js'`

- [ ] Create `src/lib/markdown.ts`:
  ```ts
  import { marked } from 'marked'
  import sanitizeHtml from 'sanitize-html'

  export async function renderMarkdown(input: string | null): Promise<string> {
    if (!input) return ''
    const raw = await marked(input)
    return sanitizeHtml(raw, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'pre', 'code']),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        'a': ['href', 'title', 'target'],
        'img': ['src', 'alt', 'title'],
        'code': ['class'],
      },
    })
  }
  ```

- [ ] Run tests to verify they pass:
  ```bash
  npm test
  ```
  Expected: 4 tests pass

- [ ] Update `src/pages/packages/[name].astro` to use `getPackageVersions` from `db.ts` and render README:
  ```astro
  ---
  import Base from '../../layouts/Base.astro'
  import { getPackageVersions, getPackageOwner } from '../../lib/db.js'
  import { renderMarkdown } from '../../lib/markdown.js'

  const { name } = Astro.params
  const versions = await getPackageVersions(name!)
  if (!versions.length) return Astro.redirect('/packages')

  const latest = versions[0]
  const owner = await getPackageOwner(name!)
  const readmeHtml = await renderMarkdown(latest.readme)
  ---
  ```
  Then in the template, add:
  - Description line below version badge: `<p class="pkg-description">{latest.description}</p>`
  - README section after install block (conditionally rendered if `readmeHtml`):
    ```astro
    {readmeHtml && (
      <div class="section">
        <p class="section-heading">readme</p>
        <div class="readme-body" set:html={readmeHtml} />
      </div>
    )}
    ```
  - Add `.pkg-description` and `.readme-body` CSS (monospace-off, prose style)

- [ ] Update `src/pages/packages/index.astro` — replace the store import with db.ts and add description to each card. Find the line that imports `PackageStore` and replace it:
  ```astro
  ---
  import Base from '../../layouts/Base.astro'
  import { listAllPackages } from '../../lib/db.js'

  const packagesMap = await listAllPackages()
  const packages = Object.entries(packagesMap)
  const totalVersions = packages.reduce((n, [, vs]) => n + Object.keys(vs).length, 0)

  const recent = packages
    .flatMap(([name, versions]) =>
      Object.values(versions).map(v => ({ name, ...v }))
    )
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, 20)
  ---
  ```
  In the package row template, add description below the name:
  ```astro
  <a class="pkg-row" href={`/packages/${pkg.name}`}>
    <div>
      <span class="pkg-name">{pkg.name}</span>
      {pkg.description && <span class="pkg-description">{pkg.description}</span>}
    </div>
    <span class="pkg-meta">v{pkg.version} &middot; {new Date(pkg.published_at).toLocaleDateString()}</span>
  </a>
  ```
  Add to `<style>`:
  ```css
  .pkg-description {
    display: block;
    font-family: system-ui, sans-serif;
    font-size: 0.8rem;
    color: var(--muted);
    margin-top: 0.2rem;
  }
  ```

- [ ] Update `src/pages/index.astro` — same import swap and same description rendering on the recent packages list. Replace `PackageStore` import with `listAllPackages` from `../../lib/db.js` and apply the same pattern above to the recent packages rows.

- [ ] Commit:
  ```bash
  git add src/lib/markdown.ts src/lib/markdown.test.ts src/pages/
  git commit -m "feat: render description and README on package pages"
  ```

---

## Chunk 6: Hybrid Search

### Task 16: NVIDIA NIM embedding client + embed on publish

**Files:**
- Create: `src/lib/embed.ts` (lectern)
- Create: `src/lib/embed.test.ts` (lectern)
- Modify: `src/pages/api/packages/[name]/[version].ts` — wire in `generateAndStoreEmbedding`

- [ ] Write failing tests — create `src/lib/embed.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import { embedText } from './embed.js'

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    process.env['NVIDIA_API_KEY'] = 'test-key'
  })

  describe('embedText', () => {
    it('returns a 1024-length number array on success', async () => {
      const mockEmbedding = Array.from({ length: 1024 }, (_, i) => i / 1024)
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: mockEmbedding }] }),
      } as Response)

      const result = await embedText('test passage', 'passage')
      expect(result).toHaveLength(1024)
      expect(result![0]).toBeCloseTo(0)
    })

    it('returns null when API key is missing', async () => {
      delete process.env['NVIDIA_API_KEY']
      const result = await embedText('test', 'query')
      expect(result).toBeNull()
    })

    it('returns null on API error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response)

      const result = await embedText('test', 'passage')
      expect(result).toBeNull()
    })
  })
  ```

- [ ] Run tests to verify they fail:
  ```bash
  npm test
  ```

- [ ] Create `src/lib/embed.ts`:
  ```ts
  const NVIDIA_EMBEDDING_URL = 'https://integrate.api.nvidia.com/v1/embeddings'
  const MODEL = 'nvidia/nv-embedqa-e5-v5'

  export async function embedText(
    text: string,
    inputType: 'passage' | 'query'
  ): Promise<number[] | null> {
    const apiKey = process.env['NVIDIA_API_KEY']
    if (!apiKey) return null

    try {
      const res = await fetch(NVIDIA_EMBEDDING_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: MODEL, input: text, input_type: inputType }),
      })

      if (!res.ok) return null
      const json = await res.json() as { data: [{ embedding: number[] }] }
      return json.data[0].embedding
    } catch {
      return null
    }
  }
  ```

- [ ] Run tests to verify they pass:
  ```bash
  npm test
  ```
  Expected: 3 embed tests pass (plus earlier tests)

- [ ] Wire embedding into the publish route — update `generateAndStoreEmbedding` in `src/pages/api/packages/[name]/[version].ts`:
  ```ts
  import { embedText } from '../../../lib/embed.js'
  import { supabase } from '../../../lib/supabase.js'

  async function generateAndStoreEmbedding(
    name: string, version: string,
    description: string | null, readme: string | null
  ): Promise<void> {
    // Strip markdown to plain text for embedding
    const plaintext = [name, description ?? '', readme?.replace(/[#*`\[\]]/g, '') ?? '']
      .filter(Boolean).join(' ').slice(0, 8000) // NIM has token limits

    const embedding = await embedText(plaintext, 'passage')
    if (!embedding) return

    await supabase
      .from('package_versions')
      .update({ embedding })
      .eq('package_name', name)
      .eq('version', version)
  }
  ```

- [ ] Commit:
  ```bash
  git add src/lib/embed.ts src/lib/embed.test.ts src/pages/api/packages/
  git commit -m "feat: add nvidia nim embedding client + embed on publish"
  ```

---

### Task 17: Hybrid search logic + endpoint

**Files:**
- Create: `src/lib/search.ts` (lectern)
- Create: `src/lib/search.test.ts` (lectern)
- Create: `src/pages/api/search.ts` (lectern)

- [ ] Write failing tests — create `src/lib/search.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { rrfMerge } from './search.js'

  describe('rrfMerge', () => {
    it('returns empty array for no results', () => {
      expect(rrfMerge([], [])).toEqual([])
    })

    it('merges results from both lists', () => {
      const fts = [{ name: 'a' }, { name: 'b' }]
      const semantic = [{ name: 'b' }, { name: 'c' }]
      const merged = rrfMerge(fts, semantic)
      expect(merged.map(r => r.name)).toContain('a')
      expect(merged.map(r => r.name)).toContain('b')
      expect(merged.map(r => r.name)).toContain('c')
    })

    it('boosts items appearing in both lists', () => {
      const fts = [{ name: 'shared' }, { name: 'fts-only' }]
      const semantic = [{ name: 'shared' }, { name: 'sem-only' }]
      const merged = rrfMerge(fts, semantic)
      expect(merged[0].name).toBe('shared') // appears in both, highest score
    })

    it('deduplicates by name', () => {
      const fts = [{ name: 'a' }, { name: 'a' }]
      const semantic = [{ name: 'a' }]
      const merged = rrfMerge(fts, semantic)
      expect(merged.filter(r => r.name === 'a')).toHaveLength(1)
    })
  })
  ```

- [ ] Run tests to verify they fail:
  ```bash
  npm test
  ```

- [ ] Create `src/lib/search.ts`:
  ```ts
  import { supabase } from './supabase.js'
  import { embedText } from './embed.js'

  export interface SearchResult {
    name: string
    version: string
    description: string | null
    score: number
  }

  interface RrfItem { name: string; [key: string]: unknown }

  export function rrfMerge(fts: RrfItem[], semantic: RrfItem[], k = 60): (RrfItem & { score: number })[] {
    const scores = new Map<string, number>()
    const items = new Map<string, RrfItem>()

    fts.forEach((item, i) => {
      const s = (scores.get(item.name) ?? 0) + 1 / (k + i + 1)
      scores.set(item.name, s)
      items.set(item.name, item)
    })

    semantic.forEach((item, i) => {
      const s = (scores.get(item.name) ?? 0) + 1 / (k + i + 1)
      scores.set(item.name, s)
      if (!items.has(item.name)) items.set(item.name, item)
    })

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, score]) => ({ ...items.get(name)!, name, score }))
  }

  export async function hybridSearch(query: string, limit = 20): Promise<SearchResult[]> {
    // Latest-version CTE is emulated by ordering + dedup in JS (Supabase JS doesn't support CTEs directly)

    // Full-text search
    const { data: ftsRows } = await supabase
      .from('package_versions')
      .select('package_name, version, description')
      .textSearch('fts', query, { type: 'plain', config: 'english' })
      .order('published_at', { ascending: false })
      .limit(limit)

    const ftsDeduped = dedupeLatest(ftsRows ?? [])

    // Semantic search (best-effort — skipped if embedding fails)
    let semDeduped: typeof ftsDeduped = []
    const embedding = await embedText(query, 'query')
    if (embedding) {
      const { data: semRows } = await supabase.rpc('match_package_versions', {
        query_embedding: embedding,
        match_count: limit,
      })
      semDeduped = dedupeLatest(semRows ?? [])
    }

    const merged = rrfMerge(
      ftsDeduped.map(r => ({ name: r.package_name, version: r.version, description: r.description })),
      semDeduped.map(r => ({ name: r.package_name, version: r.version, description: r.description })),
    )

    return merged.slice(0, limit).map(r => ({
      name: r.name as string,
      version: r.version as string,
      description: r.description as string | null,
      score: r.score,
    }))
  }

  // Keep only the latest version per package name
  function dedupeLatest<T extends { package_name: string }>(rows: T[]): T[] {
    const seen = new Set<string>()
    return rows.filter(r => {
      if (seen.has(r.package_name)) return false
      seen.add(r.package_name)
      return true
    })
  }
  ```

- [ ] Add the `match_package_versions` Postgres function to the migration (add to `supabase/migrations/001_initial.sql` or as `002_search_fn.sql`):
  ```sql
  -- supabase/migrations/002_search_fn.sql
  create or replace function match_package_versions(
    query_embedding vector(1024),
    match_count int
  )
  returns table (
    package_name text,
    version text,
    description text,
    similarity float
  )
  language sql stable
  as $$
    select
      pv.package_name,
      pv.version,
      pv.description,
      1 - (pv.embedding <=> query_embedding) as similarity
    from package_versions pv
    inner join (
      select distinct on (package_name) package_name, version
      from package_versions
      order by package_name, published_at desc
    ) latest on pv.package_name = latest.package_name and pv.version = latest.version
    where pv.embedding is not null
    order by similarity desc
    limit match_count;
  $$;
  ```
  > Save this as `supabase/migrations/002_search_fn.sql` and apply it in the Supabase SQL editor. Do NOT add it to `001_initial.sql`.

- [ ] Run tests:
  ```bash
  npm test
  ```
  Expected: all RRF tests pass

- [ ] Create `src/pages/api/search.ts`:
  ```ts
  import type { APIRoute } from 'astro'
  import { hybridSearch } from '../../lib/search.js'

  export const GET: APIRoute = async ({ request }) => {
    const url = new URL(request.url)
    const q = url.searchParams.get('q')?.trim()

    if (!q) {
      return new Response(JSON.stringify([]), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const results = await hybridSearch(q)
    return new Response(JSON.stringify(results), {
      headers: { 'Content-Type': 'application/json' }
    })
  }
  ```

- [ ] Commit:
  ```bash
  git add src/lib/search.ts src/lib/search.test.ts src/pages/api/search.ts supabase/
  git commit -m "feat: add hybrid search (RRF + pgvector + fts)"
  ```

---

### Task 18: Search UI on `/packages`

**Files:**
- Modify: `src/pages/packages/index.astro`

- [ ] Add search bar above the package list in `src/pages/packages/index.astro`:
  ```astro
  <!-- Add to frontmatter: load all packages for initial render -->
  const allPackages = Object.entries(index.packages)

  <!-- In template, add before package list: -->
  <div class="search-bar">
    <input
      id="search-input"
      class="mock-input"
      type="search"
      placeholder="Search packages…"
      autocomplete="off"
    />
  </div>

  <div id="pkg-list" class="pkg-list">
    <!-- existing package rows here -->
  </div>

  <script>
    const input = document.getElementById('search-input') as HTMLInputElement
    const list = document.getElementById('pkg-list') as HTMLDivElement
    // Capture initial HTML before any search modifies it
    const initialHtml = list.innerHTML

    let debounce: ReturnType<typeof setTimeout>

    input.addEventListener('input', () => {
      clearTimeout(debounce)
      const q = input.value.trim()

      if (!q) {
        list.innerHTML = initialHtml
        return
      }

      debounce = setTimeout(async () => {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
        const results = await res.json() as Array<{ name: string; version: string; description: string | null }>

        if (!results.length) {
          list.innerHTML = '<p class="empty">no results.</p>'
          return
        }

        // Escape values to prevent XSS — descriptions come from the server but
        // could contain user-supplied content
        function esc(s: string): string {
          return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        }

        list.innerHTML = results.map(pkg => `
          <a class="pkg-row" href="/packages/${esc(pkg.name)}">
            <div>
              <span class="pkg-name">${esc(pkg.name)}</span>
              ${pkg.description ? `<span class="pkg-description">${esc(pkg.description)}</span>` : ''}
            </div>
            <span class="pkg-meta">v${esc(pkg.version)}</span>
          </a>
        `).join('')
      }, 300)
    })
  </script>
  ```

- [ ] Add CSS for `.search-bar` and `.pkg-description` to the page's `<style>` block:
  ```css
  .search-bar { margin-bottom: 1.5rem; }
  .search-bar input { width: 100%; }
  .pkg-description {
    display: block;
    font-family: system-ui, sans-serif;
    font-size: 0.8rem;
    color: var(--muted);
    margin-top: 0.2rem;
  }
  ```

- [ ] Commit:
  ```bash
  git add src/pages/packages/index.astro
  git commit -m "feat: add search bar to /packages page"
  ```

---

## Chunk 7: Cleanup + Environment

### Task 19: Update `.env.example` and remove old env vars

**Files:**
- Create: `lectern/.env.example`

- [ ] Create `lectern/.env.example`:
  ```
  # Supabase project settings (from https://supabase.com/dashboard/project/_/settings/api)
  SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_SERVICE_KEY=your-service-role-key
  SUPABASE_ANON_KEY=your-anon-key

  # NVIDIA NIM embeddings (from https://build.nvidia.com)
  NVIDIA_API_KEY=nvapi-...

  # Public base URL (used in tarball URLs returned by the API)
  BASE_URL=https://lectern.inklang.org
  ```

- [ ] Add `.env` to `.gitignore` if not already there:
  ```bash
  grep -q "^\.env$" /c/Users/justi/dev/lectern/.gitignore || echo ".env" >> /c/Users/justi/dev/lectern/.gitignore
  ```

- [ ] Run lectern test suite one final time:
  ```bash
  cd lectern && npm test
  ```
  Expected: all tests pass (tokens, embed, search RRF, markdown — 4 test files)

- [ ] Commit:
  ```bash
  git add .env.example .gitignore
  git commit -m "chore: add .env.example, update .gitignore"
  ```
