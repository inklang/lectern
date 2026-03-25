import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PackageVersion } from '../../../../lib/db.js'

const mockVersions: PackageVersion[] = [
  {
    package_name: 'my-pkg',
    version: '1.0.0',
    description: 'A package',
    readme: null,
    dependencies: {},
    tarball_url: 'https://example.com/my-pkg/1.0.0.tar.gz',
    published_at: '2024-02-01T00:00:00Z',
  },
]

const mockStats = { total: 142, last7d: 23, last30d: 89 }

vi.mock('../../../../lib/db.js', () => ({
  getPackageVersions: vi.fn(),
  getPackageStats: vi.fn(),
}))

const { getPackageVersions, getPackageStats } = await import('../../../../lib/db.js')

describe('GET /api/packages/[name]/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns stats for an existing package', async () => {
    vi.mocked(getPackageVersions).mockResolvedValue(mockVersions)
    vi.mocked(getPackageStats).mockResolvedValue(mockStats)

    const { GET } = await import('./stats.js')
    const response = await GET({ params: { name: 'my-pkg' } } as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(mockStats)
    expect(getPackageStats).toHaveBeenCalledWith('my-pkg')
  })

  it('returns 404 for non-existent package', async () => {
    vi.mocked(getPackageVersions).mockResolvedValue([])
    vi.mocked(getPackageStats).mockResolvedValue(mockStats)

    const { GET } = await import('./stats.js')
    const response = await GET({ params: { name: 'nonexistent' } } as any)
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('Package not found')
    expect(getPackageStats).not.toHaveBeenCalled()
  })

  it('returns 400 when name is missing', async () => {
    const { GET } = await import('./stats.js')
    const response = await GET({ params: {} } as any)
    expect(response.status).toBe(400)
  })

  it('returns 500 when getPackageStats throws', async () => {
    vi.mocked(getPackageVersions).mockResolvedValue(mockVersions)
    vi.mocked(getPackageStats).mockRejectedValue(new Error('db error'))

    const { GET } = await import('./stats.js')
    const response = await GET({ params: { name: 'my-pkg' } } as any)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Database error')
  })
})
