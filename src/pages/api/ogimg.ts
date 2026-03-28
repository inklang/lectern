import type { APIRoute } from 'astro'
import { ImageResponse } from '@vercel/og'
import { getPackageVersions, getPackageOwner } from '../../lib/db.js'

export const GET: APIRoute = async ({ url }) => {
  try {
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

    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#18181b',
            padding: '40px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#18181b',
              borderRadius: '16px',
              flex: '1',
              padding: '40px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: '30px',
              }}
            >
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  backgroundColor: '#8b5cf6',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '40px',
                  marginRight: '20px',
                }}
              >
                ⬡
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <span
                  style={{
                    fontSize: '42px',
                    fontWeight: 700,
                    color: '#fafafa',
                  }}
                >
                  {title}
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    backgroundColor: '#27272a',
                    color: '#a1a1aa',
                    fontSize: '16px',
                    padding: '4px 12px',
                    borderRadius: '6px',
                    marginTop: '8px',
                  }}
                >
                  v{version}
                </span>
              </div>
            </div>
            <span
              style={{
                fontSize: '26px',
                color: '#a1a1aa',
                marginBottom: '20px',
              }}
            >
              {description}
            </span>
            <span
              style={{
                fontSize: '22px',
                color: '#71717a',
              }}
            >
              by {author}
            </span>
            <span
              style={{
                fontSize: '18px',
                color: '#52525b',
                marginTop: 'auto',
              }}
            >
              lectern.inklang.org
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: '10px',
              backgroundColor: '#8b5cf6',
            }}
          />
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    )
  } catch (error) {
    console.error('OG image error:', error)
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}