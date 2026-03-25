import type { APIRoute } from 'astro'
import { listAllPackages } from '../../lib/db.js'

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export const GET: APIRoute = async () => {
  const packagesMap = await listAllPackages()
  const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:4321'

  // Flatten to latest version per package, sorted by publish date
  const entries = Object.entries(packagesMap)
    .flatMap(([name, versions]) =>
      Object.values(versions).map(v => ({ name, ...v }))
    )
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, 50)

  const updatedAt = entries.length > 0 ? entries[0].published_at : new Date().toISOString()

  const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Lectern — Ink Package Registry</title>
  <subtitle>Recently published packages on Lectern, the Ink package registry.</subtitle>
  <link href="${baseUrl}/feed.xml" rel="self" type="application/atom+xml" />
  <link href="${baseUrl}" rel="alternate" type="text/html" />
  <id>${baseUrl}/feed.xml</id>
  <updated>${new Date(updatedAt).toISOString()}</updated>
  ${entries
    .map(
      entry => `  <entry>
    <title>${escapeXml(entry.name)}</title>
    <link href="${baseUrl}/packages/${encodeURIComponent(entry.name)}" rel="alternate" type="text/html" />
    <id>${baseUrl}/packages/${encodeURIComponent(entry.name)}/${encodeURIComponent(entry.version)}</id>
    <updated>${new Date(entry.published_at).toISOString()}</updated>
    <summary>${escapeXml(entry.description ?? '')}</summary>
    <content type="text">${escapeXml(entry.description ?? '')}</content>
  </entry>`
    )
    .join('\n')}
</feed>`

  return new Response(atom, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
