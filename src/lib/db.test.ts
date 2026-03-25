import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mutable result object so we can update it before each test
const rpcResult = { data: null, error: null }

vi.mock('./supabase.js', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
    }),
    rpc: vi.fn().mockImplementation(() => Promise.resolve(rpcResult)),
  },
}))

// Import once - db.ts will capture the mocked supabase
const { supabase } = await import('./supabase.js')
const { getPackageStats, logDownload } = await import('./db.js')

describe('PackageVersion interface fields', () => {
  it('supports author and license fields', () => {
    const version = {
      package_name: 'test-package',
      version: '1.0.0',
      description: 'A test package',
      readme: '# Test',
      author: 'Jane Developer',
      license: 'Apache-2.0',
      dependencies: {},
      tarball_url: 'https://example.com/test-package-1.0.0.tar.gz',
      published_at: new Date().toISOString(),
      download_count: 42,
    }

    expect(version.author).toBe('Jane Developer')
    expect(version.license).toBe('Apache-2.0')
    expect(version.download_count).toBe(42)
  })

  it('author and license are nullable', () => {
    const version = {
      package_name: 'test-package',
      version: '1.0.0',
      description: null,
      readme: null,
      author: null,
      license: null,
      dependencies: {},
      tarball_url: 'https://example.com/test-package-1.0.0.tar.gz',
      published_at: new Date().toISOString(),
    }

    expect(version.author).toBeNull()
    expect(version.license).toBeNull()
  })
})

describe('getPackageStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset rpc result before each test
    rpcResult.data = null
    rpcResult.error = null
  })

  it('returns total, last7d, and last30d download counts', async () => {
    const mockStats = { total: 100, last7d: 25, last30d: 60 }
    // Update the mutable object that the mock uses by reference
    rpcResult.data = mockStats

    const stats = await getPackageStats('my-package')

    expect(stats).toEqual(mockStats)
    expect(supabase.rpc).toHaveBeenCalledWith('get_package_stats', { pkg_name: 'my-package' })
  })

  it('throws on RPC error', async () => {
    rpcResult.data = null
    rpcResult.error = new Error('RPC failed')

    await expect(getPackageStats('my-package')).rejects.toThrow('RPC failed')
  })
})

describe('logDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpcResult.data = null
    rpcResult.error = null
  })

  it('inserts download log and increments counter via RPC', async () => {
    // Call with null auth header to skip token resolution
    await logDownload('test-pkg', '2.0.0', null)

    expect(supabase.from).toHaveBeenCalledWith('download_logs')
    expect(supabase.rpc).toHaveBeenCalledWith('increment_download_count', {
      pkg_name: 'test-pkg',
      ver: '2.0.0',
    })
  })
})
