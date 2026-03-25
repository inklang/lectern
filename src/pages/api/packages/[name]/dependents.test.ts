import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../lib/db.js', () => ({
  getPackageDependents: vi.fn(),
}))

const { getPackageDependents } = await import('../../../../lib/db.js')

describe('GET /api/packages/[name]/dependents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns dependents for a package', async () => {
    const mockDependents = [
      { package_name: 'dependent-pkg', version: '1.0.0', dep_version: '^1.0.0' },
      { package_name: 'dependent-pkg', version: '2.0.0', dep_version: '^2.0.0' },
    ]
    vi.mocked(getPackageDependents).mockResolvedValue(mockDependents)

    const { GET } = await import('./dependents.js')
    const response = await GET({ params: { name: 'my-pkg' } } as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.dependents).toEqual(mockDependents)
    expect(getPackageDependents).toHaveBeenCalledWith('my-pkg')
  })

  it('returns 400 when name is missing', async () => {
    const { GET } = await import('./dependents.js')
    const response = await GET({ params: {} } as any)

    expect(response.status).toBe(400)
  })

  it('returns empty array when no dependents', async () => {
    vi.mocked(getPackageDependents).mockResolvedValue([])

    const { GET } = await import('./dependents.js')
    const response = await GET({ params: { name: 'orphan-pkg' } } as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.dependents).toEqual([])
  })
})
