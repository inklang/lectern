import { describe, it, expect, vi, beforeEach } from 'vitest'
import { embedText } from './embed.js'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  process.env['NVIDIA_API_KEY'] = 'test-key'
})

describe('embedText', () => {
  it('returns a 1024-length number array on success', async () => {
    const mockEmbedding = Array.from({ length: 1024 }, (_, i) => i / 1024)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: mockEmbedding }] }),
    } as Response)

    const result = await embedText('test passage', 'passage')
    expect(result).toHaveLength(1024)
    expect(result![0]).toBeCloseTo(0)
  })

  it('returns null when API key is missing', async () => {
    delete process.env['NVIDIA_API_KEY']
    const result = await embedText('test', 'query')
    expect(result).toBeNull()
  })

  it('returns null on API error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response)

    const result = await embedText('test', 'passage')
    expect(result).toBeNull()
  })
})
