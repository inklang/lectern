import { describe, it, expect } from 'vitest'
import { hashToken, verifyToken, extractBearer } from './tokens.js'

describe('hashToken', () => {
  it('returns a 64-char hex string', () => {
    const hash = hashToken('abc123')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    expect(hashToken('test')).toBe(hashToken('test'))
  })

  it('differs for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'))
  })
})

describe('verifyToken', () => {
  it('returns true when hash matches', () => {
    const raw = 'mysecrettoken'
    const hash = hashToken(raw)
    expect(verifyToken(raw, hash)).toBe(true)
  })

  it('returns false when hash does not match', () => {
    expect(verifyToken('wrong', hashToken('right'))).toBe(false)
  })
})

describe('extractBearer', () => {
  it('extracts token from Authorization header', () => {
    expect(extractBearer('Bearer abc123')).toBe('abc123')
  })

  it('returns null for missing header', () => {
    expect(extractBearer(null)).toBeNull()
  })

  it('returns null for non-Bearer scheme', () => {
    expect(extractBearer('Basic abc123')).toBeNull()
  })
})
