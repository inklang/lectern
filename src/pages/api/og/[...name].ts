import type { APIRoute } from 'astro'
import { getPackageVersions, getPackageOwner } from '../../../lib/db.js'
import satori from 'satori'
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

  // Fetch font
  const fontResponse = await fetch('https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.0.18/files/jetbrains-mono-latin-400-normal.woff')
  const fontData = await fontResponse.arrayBuffer()

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#09090b',
          padding: '40px',
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: '#18181b',
                borderRadius: '16px',
                border: '2px solid #3f3f46',
                flex: 1,
                padding: '40px',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      marginBottom: '30px',
                    },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            width: '80px',
                            height: '80px',
                            backgroundColor: '#8b5cf6',
                            borderRadius: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '40px',
                            marginRight: '20px',
                          },
                          children: '⬡',
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                            flexDirection: 'column',
                          },
                          children: [
                            {
                              type: 'span',
                              props: {
                                style: {
                                  fontSize: '48px',
                                  fontWeight: 600,
                                  color: '#fafafa',
                                },
                                children: title,
                              },
                            },
                            {
                              type: 'span',
                              props: {
                                style: {
                                  display: 'inline-flex',
                                  backgroundColor: '#27272a',
                                  color: '#a1a1aa',
                                  fontSize: '18px',
                                  padding: '4px 12px',
                                  borderRadius: '6px',
                                  marginTop: '8px',
                                },
                                children: `v${version}`,
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  type: 'span',
                  props: {
                    style: {
                      fontSize: '28px',
                      color: '#a1a1aa',
                      marginBottom: '20px',
                    },
                    children: description,
                  },
                },
                {
                  type: 'span',
                  props: {
                    style: {
                      fontSize: '24px',
                      color: '#71717a',
                    },
                    children: `by ${author}`,
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'JetBrains Mono',
          data: fontData,
          weight: 400,
          style: 'normal',
        },
      ],
    },
  )

  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer()

  return new Response(pngBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
