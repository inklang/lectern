import type { APIRoute } from 'astro'
import { getPackageVersions, getPackageOwner } from '../../../lib/db.js'

export const GET: APIRoute = async ({ url }) => {
  const pkg = url.searchParams.get('pkg')
  if (!pkg) {
    return new Response('Missing pkg parameter', { status: 400 })
  }

  const packageSlug = pkg

  const versions = await getPackageVersions(packageSlug)
  if (versions.length === 0) {
    return new Response('Package not found', { status: 404 })
  }

  const latest = versions[0]
  const owner = await getPackageOwner(packageSlug)

  const title = packageSlug
  const description = latest.description?.slice(0, 150) || `${packageSlug} — an Ink package`
  const version = latest.version
  const author = owner?.name || owner?.username || 'Unknown'

  // Generate SVG OG image
  const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#09090b"/>
  <rect x="40" y="40" width="1120" height="550" rx="16" fill="#18181b" stroke="#3f3f46" stroke-width="2"/>

  <!-- Package icon -->
  <rect x="80" y="180" width="80" height="80" rx="12" fill="#8b5cf6"/>
  <text x="120" y="235" font-family="monospace" font-size="40" fill="white" text-anchor="middle">⬡</text>

  <!-- Package name -->
  <text x="200" y="230" font-family="ui-monospace, monospace" font-size="48" font-weight="600" fill="#fafafa">${escapeXml(title)}</text>

  <!-- Version badge -->
  <rect x="200" y="250" width="${version.length * 20 + 30}" height="36" rx="6" fill="#27272a"/>
  <text x="215" y="276" font-family="ui-monospace, monospace" font-size="18" fill="#a1a1aa">v${escapeXml(version)}</text>

  <!-- Description -->
  <text x="80" y="360" font-family="ui-sans-serif, system-ui, sans-serif" font-size="28" fill="#a1a1aa">${escapeXml(description)}</text>

  <!-- Author -->
  <text x="80" y="430" font-family="ui-sans-serif, system-ui, sans-serif" font-size="24" fill="#71717a">by ${escapeXml(author)}</text>

  <!-- Footer -->
  <text x="80" y="540" font-family="ui-monospace, monospace" font-size="20" fill="#52525b">lectern.inklang.org</text>

  <!-- Accent line -->
  <rect x="0" y="620" width="1200" height="10" fill="#8b5cf6"/>
</svg>`

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
