import { describe, it, expect } from 'vitest'
import { rrfMerge } from './search.js'

describe('rrfMerge', () => {
  it('returns empty array for no results', () => {
    expect(rrfMerge([], [])).toEqual([])
  })

  it('merges results from both lists', () => {
    const fts = [{ name: 'a' }, { name: 'b' }]
    const semantic = [{ name: 'b' }, { name: 'c' }]
    const merged = rrfMerge(fts, semantic)
    expect(merged.map(r => r.name)).toContain('a')
    expect(merged.map(r => r.name)).toContain('b')
    expect(merged.map(r => r.name)).toContain('c')
  })

  it('boosts items appearing in both lists', () => {
    const fts = [{ name: 'shared' }, { name: 'fts-only' }]
    const semantic = [{ name: 'shared' }, { name: 'sem-only' }]
    const merged = rrfMerge(fts, semantic)
    expect(merged[0].name).toBe('shared') // appears in both, highest score
  })

  it('deduplicates by name', () => {
    const fts = [{ name: 'a' }, { name: 'a' }]
    const semantic = [{ name: 'a' }]
    const merged = rrfMerge(fts, semantic)
    expect(merged.filter(r => r.name === 'a')).toHaveLength(1)
  })
})
