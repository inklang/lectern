import type { APIRoute } from 'astro'
import { getPackageVersions, getPackageOwner } from '../../lib/db.js'
import sharp from 'sharp'

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

  const svg = \`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#09090b"/>
  <rect x="40" y="40" width="1120" height="550" rx="16" fill="#18181b" stroke="#3f3f46" stroke-width="2"/>
  <rect x="80" y="160" width="80" height="80" rx="12" fill="#8b5cf6"/>
  <text x="120" y="215" font-family="Arial, sans-serif" font-size="40" fill="white" text-anchor="middle" font-weight="bold">&#x2B21;</text>
  <text x="200" y="210" font-family="Arial, sans-serif" font-size="42" fill="#fafafa" font-weight="bold">\${escapeXml(title)}</text>
  <rect x="200" y="225" width="\${version.length * 18 + 30}" height="32" rx="6" fill="#27272a"/>
  <text x="215" y="248" font-family="Arial, sans-serif" font-size="16" fill="#a1a1aa">v\${escapeXml(version)}</text>
  <text x="80" y="340" font-family="Arial, sans-serif" font-size="26" fill="#a1a1aa">\${escapeXml(description)}</text>
  <text x="80" y="400" font-family="Arial, sans-serif" font-size="22" fill="#71717a">by \${escapeXml(author)}</text>
  <text x="80" y="520" font-family="Arial, sans-serif" font-size="18" fill="#52525b">lectern.inklang.org</text>
  <rect x="0" y="620" width="1200" height="10" fill="#8b5cf6"/>
</svg>\`

  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer()

  return new Response(pngBuffer, {
    headers: {
      'Content-Type': 'image/png',
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
