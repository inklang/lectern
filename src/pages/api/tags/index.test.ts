import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockTags = [
  { name: 'utilities', package_count: 5 },
  { name: 'parsing', package_count: 3 },
  { name: 'testing', package_count: 1 },
]

vi.mock('../../../lib/db.js', () => ({
  listTags: vi.fn(),
}))

const { listTags } = await import('../../../lib/db.js')

describe('GET /api/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all tags with counts', async () => {
    vi.mocked(listTags).mockResolvedValue(mockTags)

    const { GET } = await import('./index.js')
    const response = await GET({} as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(mockTags)
    expect(listTags).toHaveBeenCalled()
  })

  it('returns 500 on database error', async () => {
    vi.mocked(listTags).mockRejectedValue(new Error('db error'))

    const { GET } = await import('./index.js')
    const response = await GET({} as any)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Database error')
  })
})
