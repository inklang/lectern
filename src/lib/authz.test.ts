import { describe, it, expect, vi } from 'vitest'

// Mock the supabase module to avoid env var requirements during import
vi.mock('./supabase.js', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null }),
  },
}))

describe('authz API surface', () => {
  it('exports canUserPublish and getPackageOrgSlug', async () => {
    const authz = await import('./authz.js')
    expect(typeof authz.canUserPublish).toBe('function')
    expect(typeof authz.getPackageOrgSlug).toBe('function')
  })
})
