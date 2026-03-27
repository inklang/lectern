import type { APIRoute } from 'astro'
import { getPackageVersions, getPackageOwner } from '../../../lib/db.js'
import { ImageResponse } from '@vercel/og'

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

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#09090b',
          padding: '40px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#18181b',
            borderRadius: '16px',
            border: '2px solid #3f3f46',
            flex: 1,
            padding: '40px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '30px' }}>
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
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span
                style={{
                  fontSize: '48px',
                  fontWeight: 600,
                  color: '#fafafa',
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                {title}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  backgroundColor: '#27272a',
                  color: '#a1a1aa',
                  fontSize: '18px',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  marginTop: '8px',
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                v{version}
              </span>
            </div>
          </div>
          <span
            style={{
              fontSize: '28px',
              color: '#a1a1aa',
              marginBottom: '20px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {description}
          </span>
          <span style={{ fontSize: '24px', color: '#71717a', marginBottom: '20px' }}>
            by {author}
          </span>
          <span
            style={{
              fontSize: '20px',
              color: '#52525b',
              fontFamily: 'ui-monospace, monospace',
              marginTop: 'auto',
            }}
          >
            lectern.inklang.org
          </span>
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
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
    },
  )
}
