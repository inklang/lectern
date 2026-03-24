# lectern

Package registry server and frontend for the [Ink](https://github.com/inklang/ink) programming language. Powers [lectern.inklang.org](https://lectern.inklang.org).

Built with [Astro](https://astro.build) in SSR mode with the Node standalone adapter.

## API

### `GET /index.json`
Returns the full package index consumed by `quill install` and `quill add`.

```json
{
  "packages": {
    "ink.mobs": {
      "0.1.0": {
        "version": "0.1.0",
        "url": "https://lectern.inklang.org/api/packages/ink.mobs/0.1.0",
        "dependencies": {},
        "publishedAt": "2026-03-24T00:00:00.000Z"
      }
    }
  },
  "owners": { "ink.mobs": "<key-fingerprint>" },
  "keys": { "<fingerprint>": "<base64-spki-public-key>" }
}
```

### `POST /api/auth/register`
Register a public key. Called by `quill login`.

```json
{ "publicKey": "<base64-spki>", "fingerprint": "<hex-sha256-prefix>" }
```

Returns `201` on first registration, `200` if already registered.

### `PUT /api/packages/:name/:version`
Publish a package tarball. Called by `quill publish`.

Required headers:
- `Content-Type: application/gzip`
- `X-Ink-Public-Key: <base64-spki>`
- `X-Ink-Signature: <base64-ed25519-sig-over-tarball>`

Rules:
- Key must be registered via `/api/auth/register` first
- Signature must verify against the tarball body
- First publisher claims ownership — subsequent publishes must use the same key
- A version cannot be republished once it exists

### `GET /api/packages/:name/:version`
Download a package tarball.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `BASE_URL` | `https://lectern.inklang.org` | Public base URL, used to construct tarball download URLs |
| `LECTERN_TOKENS` | — | Comma-separated static bearer tokens (legacy admin auth) |
| `STORAGE_DIR` | `./storage` | Directory for `index.json` and tarballs |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `4321` | Port |

## Storage layout

```
storage/
  index.json          # package index, owners, registered keys
  tarballs/
    ink.mobs/
      ink.mobs-0.1.0.tar.gz
```

The `storage/` directory should be kept outside the repo and persisted across deploys (Docker named volume in production).

## Deploying

Requires Docker and Docker Compose.

```bash
# Clone and run deploy script — generates token automatically on first run
git clone https://github.com/inklang/lectern.git /opt/lectern/repo
bash /opt/lectern/repo/scripts/deploy.sh
```

To redeploy after a code change:
```bash
bash /opt/lectern/repo/scripts/deploy.sh
```

To rotate the publish token:
```bash
bash /opt/lectern/repo/scripts/rotate-token.sh
```

## Development

```bash
npm install
npm run dev       # http://localhost:4321
npm run build
npm run preview
```
