import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PackageVersion } from '../../../../lib/db.js'

const mockVersions: PackageVersion[] = [
  {
    package_name: 'my-pkg',
    version: '1.2.3',
    description: 'Latest release',
    readme: null,
    dependencies: { ink: '^1.0.0' },
    tarball_url: 'https://example.com/my-pkg/1.2.3.tar.gz',
    published_at: '2024-02-01T00:00:00Z',
  },
  {
    package_name: 'my-pkg',
    version: '1.0.0',
    description: 'Initial release',
    readme: null,
    dependencies: {},
    tarball_url: 'https://example.com/my-pkg/1.0.0.tar.gz',
    published_at: '2024-01-15T00:00:00Z',
  },
]

vi.mock('../../../../lib/db.js', () => ({
  getPackageVersions: vi.fn(),
}))

const { getPackageVersions } = await import('../../../../lib/db.js')

describe('GET /api/packages/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all versions for a package', async () => {
    vi.mocked(getPackageVersions).mockResolvedValue(mockVersions)

    const { GET } = await import('./index.js')
    const response = await GET({ params: { name: 'my-pkg' } } as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.name).toBe('my-pkg')
    expect(body.latest_version).toBe('1.2.3')
    expect(body.versions).toHaveLength(2)
    expect(body.versions[0].version).toBe('1.2.3')
    expect(body.versions[1].version).toBe('1.0.0')
  })

  it('returns correct latest_version (most recent by published_at)', async () => {
    // Simulate getPackageVersions returning versions where 1.0.0 was published AFTER 1.2.3
    // (i.e., a hypothetical "update" that downgrades - to verify the API always picks [0])
    const reversedOrder: PackageVersion[] = [
      {
        package_name: 'my-pkg',
        version: '1.0.0',
        description: 'Later in time',
        readme: null,
        dependencies: {},
        tarball_url: 'https://example.com/my-pkg/1.0.0.tar.gz',
        published_at: '2024-03-01T00:00:00Z',
      },
      {
        package_name: 'my-pkg',
        version: '1.2.3',
        description: 'Earlier',
        readme: null,
        dependencies: { ink: '^1.0.0' },
        tarball_url: 'https://example.com/my-pkg/1.2.3.tar.gz',
        published_at: '2024-01-15T00:00:00Z',
      },
    ]
    vi.mocked(getPackageVersions).mockResolvedValue(reversedOrder)

    const { GET } = await import('./index.js')
    const response = await GET({ params: { name: 'my-pkg' } } as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    // latest_version should be 1.0.0 because it is first in the array (most recent by published_at per db order)
    expect(body.latest_version).toBe('1.0.0')
  })

  it('returns 404 for non-existent package', async () => {
    vi.mocked(getPackageVersions).mockResolvedValue([])

    const { GET } = await import('./index.js')
    const response = await GET({ params: { name: 'nonexistent' } } as any)
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('Package not found')
  })

  it('returns correct shape for each version', async () => {
    vi.mocked(getPackageVersions).mockResolvedValue([mockVersions[0]])

    const { GET } = await import('./index.js')
    const response = await GET({ params: { name: 'my-pkg' } } as any)
    const body = await response.json()

    expect(body.versions[0]).toEqual({
      version: '1.2.3',
      description: 'Latest release',
      published_at: '2024-02-01T00:00:00Z',
      dependencies: { ink: '^1.0.0' },
    })
  })
})
