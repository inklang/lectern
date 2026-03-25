# Plan: quill CLI Developer Workflow Commands

## Feature Description

Implement three new quill CLI commands: `quill new`, `quill outdated`, `quill info`.

**Note:** The quill CLI lives in a separate `@inklang/quill` npm package, not in this repository. This plan covers both the CLI changes and any registry API support needed.

## Registry API Support Needed

### Phase 1: Outdated Check API
1. Add `GET /api/packages/[name]` endpoint (or enhance existing) to return:
   - Latest version from registry
   - All published versions
2. The CLI will compare `ink-package.toml` dependencies against registry data

## CLI Implementation (separate package)

### Phase 2: `quill new` - Scaffold Package
1. Create new package directory structure:
   - `ink-package.toml` (template)
   - `src/main.ink` (entry point template)
   - `README.md`
2. Initialize git repo
3. Run `quill install` to set up dependencies

### Phase 3: `quill outdated` - Check Updates
1. Parse `ink-package.toml` to get dependencies
2. Query registry for each dependency's latest version
3. Display table: package | current | latest | update available
4. Support `--filter <pkg>` to check specific package

### Phase 4: `quill info` - Inspect Without Installing
1. `quill info <package>` - fetch and display:
   - Latest version
   - Description
   - Repository URL
   - README (first 50 lines truncated)
2. `quill info <package>@<version>` - specific version info
3. Uses `GET /api/packages/[name]` endpoint

## Registry API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/packages/[name]` | Returns all versions with metadata (needed for outdated) |

## Critical Files (registry side)
- `src/pages/api/packages/[name]/index.ts` - new or enhanced endpoint

## CLI Files (separate package)
- `src/commands/new.ts`
- `src/commands/outdated.ts`
- `src/commands/info.ts`

## Dependencies
- Phase 1 must be done before CLI `outdated` and `info` can work

## Complexity
Medium
