# GitHub Actions Integration Design

**Date:** 2026-03-27
**Status:** Draft

## Overview

This spec covers three GitHub Actions integrations for Lectern:

1. **CI Badge** — SVG badge on the package README tab and package page showing CI status, linking to GitHub workflow runs. Derived from the `repository` field in `ink.toml` on publish.
2. **Starter Workflow Doc** — a Starlight doc page (`.mdx`) with a copy-paste `.github/workflows/ci.yml` template using the `inklang/action-install` GitHub Action.
3. **`inklang/action-install` GitHub Action** — an official JavaScript GitHub Action that auto-discovers `ink.toml` and runs `ink install --ci` in CI environments.

All three work together: the doc page teaches users to set up CI, the GitHub Action makes it drop-dead simple, and the badge makes the CI status visible directly on Lectern.

---

## 1. GitHub Repository Detection

### Goal

Automatically associate a GitHub repository with each package on publish, without requiring users to manually connect anything in a settings UI (though a manual override is available as a fallback).

### Detection Flow

On every package publish (`PUT /api/packages/:name/:version`):

1. The Ink CLI sends `ink.toml` contents as part of the publish payload (already the case today).
2. Lectern's publish handler parses `ink.toml` looking for a top-level `repository` field.
3. The field supports two formats:
   - URL: `https://github.com/owner/repo` or `git+https://github.com/owner/repo`
   - Shorthand: `github.com/owner/repo`
4. The value is normalized to an `owner/repo` slug form.
5. The slug is stored in `packages.github_repo`.

### ink.toml Example

```toml
name = "mypackage"
version = "1.0.0"
repository = "https://github.com/alice/mypackage"

[dependencies]
# ...
```

### ink.lock Fallback

If `ink.toml` has no `repository` field, Lectern falls back to the `repository` field in `ink.lock` (if present and not empty). The `ink.lock` file is included in the publish tarball.

### DB Changes

**`packages` table — add column:**

| Column | Type | Notes |
|---|---|---|
| `github_repo` | `text` | `owner/repo` slug. Nullable. Auto-detected from ink.toml on publish. |

```sql
ALTER TABLE packages ADD COLUMN github_repo text;
CREATE INDEX idx_packages_github_repo ON packages(github_repo) WHERE github_repo IS NOT NULL;
```

### Override

Users who publish from a fork, mirror, or a monorepo subdirectory where `ink.toml` has no `repository` field can set the repo manually via the settings UI (`/[user]/[slug]/settings/ci`). The auto-detected value is shown greyed-out as read-only context; the user sets an override value that is stored in `packages.github_repo` and used for all badge generation.

---

## 2. CI Badge API

### Goal

Serve an SVG CI status badge at a stable URL: `GET /api/badges/[name]/ci.svg`. Works for all public GitHub repos using the shields.io GitHub Actions workflow badge API.

### Badge URL Construction

1. Fetch `packages.github_repo` from the DB.
2. If `NULL`, return a "not configured" badge: `https://img.shields.io/badge/ci-unknown-lightgray?style=flat-square`.
3. Construct the shields.io URL:
   ```
   https://img.shields.io/github/actions/workflow/status/{owner}/{repo}/ci.yml?branch={branch}
   ```
   - `owner` / `repo` — from `github_repo`
   - `branch` — query param `?branch=main`, defaults to repo default branch (GitHub redirects)
   - Workflow filename — defaults to `ci.yml`; configurable in settings (`workflow_filename` column, nullable)
4. Return a **302 redirect** to the shields.io URL.

### Endpoint

```
GET /api/badges/[name]/ci.svg
GET /api/badges/[name]/ci.svg?branch=develop
```

**Response:** 302 redirect to shields.io badge URL.

**Error states:**

| Condition | Response |
|---|---|
| Package not found | 302 → `https://img.shields.io/badge/ci-unknown-lightgray?style=flat-square` |
| `github_repo` is NULL (not configured) | 302 → `https://img.shields.io/badge/ci-unknown-lightgray?style=flat-square` |
| shields.io unreachable | 200 with inline SVG "ci unavailable" placeholder (hardcoded in our codebase) |

### DB Changes

**`packages` table — add column:**

| Column | Type | Notes |
|---|---|---|
| `workflow_filename` | `text` | Nullable. Default: `ci.yml`. Set by user in settings UI. |

```sql
ALTER TABLE packages ADD COLUMN workflow_filename text DEFAULT 'ci.yml';
```

### Caching Note

shields.io handles badge caching. Lectern does not proxy the image — we only redirect. This keeps the endpoint stateless and avoids hosting costs.

### Future Phase: GitHub App Upgrade

Once Lectern has a GitHub App for OAuth (enabling GitHub login), the badge endpoint can be upgraded to:

- Call `GET /repos/{owner}/{repo}/actions/runs` via the GitHub App user's token.
- Return a dynamically-generated SVG with real status from GitHub's API (passing/failing/running).
- This removes the dependency on shields.io and gives accurate real-time status.

This is **out of scope for v1** but documented here as the planned upgrade path.

---

## 3. Settings UI — CI Configuration

### Route

```
/[user]/[slug]/settings/ci
```

### Page Layout

- **Header**: "CI/CD Integration" with the current GitHub repo shown (auto-detected badge + "Read-only" label).
- **Override section**:
  - Text input: "GitHub Repository" — pre-filled with the detected `github_repo` value, disabled (greyed-out) with a tooltip "Auto-detected from ink.toml. Override below if needed."
  - Checkbox: "Override auto-detected repository" — enables the override input below.
  - Text input (shown when override enabled): "GitHub Repository" — freeform `owner/repo` field, validated to match `^[^/]+/[^/]+$`.
  - Text input: "Workflow filename" — defaults to `ci.yml`, validated.
- **Save button**: `PUT /api/packages/:name/settings/ci`
- **Live badge preview**: On save, show the badge at `/api/badges/[name]/ci.svg` inline below the form.

### API: Save CI Settings

```
PUT /api/packages/:name/settings/ci
```

**Request body:**

```json
{
  "github_repo": "alice/mypackage",
  "workflow_filename": "ci.yml"
}
```

**Behavior:**

- Auth: owner or org member with `admin` on the package.
- Writes `github_repo` and `workflow_filename` to `packages` row.
- Triggers a re-validation badge fetch (shields.io caches; next page load shows new result).
- Returns `200` on success, `403` if unauthorized, `404` if package not found.

### Starlight Sidebar Addition

Add a new "CI/CD" entry under the "Publishing" sidebar group:

```js
// astro.config.mjs sidebar
{
  label: 'Publishing',
  items: [
    { label: 'Webhooks', slug: 'webhooks' },
    { label: 'CI/CD', slug: 'ci-cd' },  // new
  ]
}
```

---

## 4. Starter Workflow Documentation

### New Doc Page

**File:** `src/content/docs/ci-cd.mdx`
**Slug:** `ci-cd`

### Page Structure

```mdx
---
title: CI/CD
description: Set up continuous integration for your Ink package with GitHub Actions.
---

# CI/CD

Add automated testing to your Ink package in minutes.

## Quick Start

Copy this workflow into `.github/workflows/ci.yml` in your repository:

\`\`\`yaml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: inklang/action-install@v1
      - run: ink test
\`\`\`

## Starter Workflow Template

Full workflow with linting, testing, and caching:

\`\`\`yaml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

env:
  INK_VERSION: '1'  # Pin to a specific Ink major version

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: inklang/action-install@v1
        with:
          version: ${{ env.INK_VERSION }}
      - run: ink lint

  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: inklang/action-install@v1
        with:
          version: ${{ env.INK_VERSION }}
      - run: ink test

  # Optional: publish only on tagged releases
  publish:
    needs: test
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: inklang/action-install@v1
        with:
          version: ${{ env.INK_VERSION }}
      - run: quill publish
        env:
          QUILL_TOKEN: ${{ secrets.QUILL_TOKEN }}
```

## Setting the `QUILL_TOKEN` Secret

1. Go to your GitHub repository **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**.
3. Name: `QUILL_TOKEN`, Value: your Lectern API token (from `/settings/api-tokens`).
4. Reference it in the workflow: `QUILL_TOKEN: ${{ secrets.QUILL_TOKEN }}`.

## Badge in Your README

Once your workflow is running, add the CI badge to your `README.md`:

\`\`\`md
[![CI](https://lectern.inklang.org/api/badges/yourname/yourpackage/ci.svg)](https://github.com/yourname/yourpackage/actions)
\`\`\`

Replace `yourname/yourpackage` with your package's Lectern URL slug.

## Monorepos

If your `ink.toml` lives in a subdirectory, use the `repo` input:

\`\`\`yaml
- uses: inklang/action-install@v1
  with:
    repo: owner/repo
    version: ${{ env.INK_VERSION }}
\`\`\`

## Further Reading

- [Webhooks](/webhooks) — get notified on publish, star, and dependent events
- [Publishing](/publishing) — full publishing reference
```

---

## 5. `inklang/action-install` GitHub Action

### Repository

`github.com/inklang/action-install`

### Action Metadata

**`action.yml`:**

```yaml
name: 'Install Ink'
description: 'Auto-discovers ink.toml and installs Ink for CI environments'
author: 'inklang'

inputs:
  version:
    description: 'Ink version range (e.g., "1", "1.2", "1.2.3"). Defaults to latest.'
    required: false
    default: ''
  repo:
    description: 'GitHub repo (owner/repo) for monorepos where ink.toml is not in the workflow repo root.'
    required: false
    default: ''

runs:
  using: 'composite'
  steps:
    - name: Detect ink.toml
      shell: bash
      run: |
        INK_TOML_PATH="ink.toml"
        if [ -n "${{ inputs.repo }}" ]; then
          OWNER_REPO="${{ inputs.repo }}"
          WORKING_DIR="/tmp/ink-action-repo"
          rm -rf "$WORKING_DIR"
          git clone --depth 1 "https://github.com/$OWNER_REPO.git" "$WORKING_DIR"
          INK_TOML_PATH="$WORKING_DIR/ink.toml"
        fi
        if [ ! -f "$INK_TOML_PATH" ]; then
          echo "::error::ink.toml not found at $INK_TOML_PATH"
          exit 1
        fi
        echo "INK_TOML_PATH=$INK_TOML_PATH" >> $GITHUB_ENV
        echo "WORKING_DIR=$(dirname $INK_TOML_PATH)" >> $GITHUB_ENV

    - name: Determine Ink version
      shell: bash
      run: |
        if [ -n "${{ inputs.version }}" ]; then
          VERSION="${{ inputs.version }}"
        else
          # Parse version from ink.toml
          VERSION=$(grep -E '^version\s*=' "$INK_TOML_PATH" | cut -d'"' -f2 | cut -d'.' -f1)
          if [ -z "$VERSION" ]; then VERSION="1"; fi
        fi
        echo "INK_VERSION=$VERSION" >> $GITHUB_ENV

    - name: Install Ink
      shell: bash
      run: |
        curl -fsSL "https://get.inklang.org/v$INK_VERSION/install.sh" | bash -s -- --dir "$WORKING_DIR"
        echo "$WORKING_DIR" >> $GITHUB_PATH

    - name: Verify installation
      shell: bash
      run: ink --version
```

### Version Tagging

- Use **Annotated tags** on the repo for each release: `v1`, `v1.2`, `v1.2.3`.
- The `action.yml` at `v1` tracks the latest `1.x.x` compatible with Ink v1.
- **Breaking changes** get a new major tag: `v2`.

### Behavior

1. **Auto-discovery**: If `ink.toml` exists at the repo root, it is used directly. If `repo` input is provided, the repo is cloned to a temp directory and the `ink.toml` is found there.
2. **Version resolution**: If `version` input is empty, the major version is parsed from `ink.toml`'s `version` field (e.g., `"1.2.3"` → `1`). Falls back to `INK_VERSION=1`.
3. **Install script**: Fetches the Ink install script from `get.inklang.org` with the resolved version, installs to the working directory.
4. **Exit codes**: Propagates the install script's exit code. If the install fails, the step fails with the script's error message.

### Compatibility

Tested against:
- `ubuntu-latest` (Linux x64)
- `windows-latest` (Windows x64)
- `macos-latest` (macOS x64)

### Out of Scope

- Self-hosted runners with non-standard OSes — may work but not tested.
- Installing a specific full version string (e.g., `1.2.3`) — only major version ranges are tested.

---

## Summary of Changes

| Area | Changes |
|---|---|
| DB | `packages.github_repo` (text, nullable). `packages.workflow_filename` (text, default `ci.yml`). |
| API | `GET /api/badges/[name]/ci.svg` (302 redirect to shields.io). `PUT /api/packages/:name/settings/ci` (save CI settings). |
| Settings UI | New route `/[user]/[slug]/settings/ci`. Override github_repo, set workflow_filename. Live badge preview. |
| Docs | New `src/content/docs/ci-cd.mdx`. Starlight sidebar entry under Publishing. |
| GitHub Action | New repo `github.com/inklang/action-install`. Composite JS action with `version` and `repo` inputs. |

---

## Out of Scope for v1

- **Private repo CI badges** — shields.io requires no auth for public repos; private repos require GitHub App (future phase).
- **Badge on Lectern package page header** — v1 focuses on the README badge link. Package page header badge can be added as a follow-up.
- **Auto-update badge on CI completion** — webhook from GitHub to Lectern to refresh badge cache. Not needed since shields.io polls GitHub.
- **GitHub App for OAuth login** — referenced as the upgrade path for real-time private-repo badges.

---

## Phasing

**Phase 1 (this spec):**
- DB columns + publish detection
- `GET /api/badges/[name]/ci.svg` (shields.io redirect)
- Settings UI + save endpoint
- Starlight `ci-cd.mdx` doc
- `inklang/action-install` v1

**Phase 2 (future):**
- Badge on package page header
- GitHub App upgrade for real-time private-repo badges
- GitHub App OAuth login
