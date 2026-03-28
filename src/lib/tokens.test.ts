import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, createHash, sign as cryptoSign } from 'crypto'
import { parseInkV1Header, verifyInkV1 } from './tokens.js'

function makeTestKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const pubDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer
  const keyId = createHash('sha256').update(pubDer).digest('hex').slice(0, 32)
  return {
    keyId,
    publicKeyB64: pubDer.toString('base64'),
    privateKeyB64: privDer.toString('base64'),
  }
}

function makeHeader(keyId: string, privateKeyB64: string, tsOverride?: number): string {
  const ts = (tsOverride ?? Date.now()).toString()
  const payload = Buffer.from(`${keyId}:${ts}`)
  const privDer = Buffer.from(privateKeyB64, 'base64')
  const sig = cryptoSign(null, payload, { key: privDer, format: 'der', type: 'pkcs8' })
  return `Ink-v1 keyId=${keyId},ts=${ts},sig=${sig.toString('base64')}`
}

describe('parseInkV1Header', () => {
  it('parses a valid header', () => {
    const { keyId, privateKeyB64 } = makeTestKeypair()
    const header = makeHeader(keyId, privateKeyB64)
    const parsed = parseInkV1Header(header)
    expect(parsed).not.toBeNull()
    expect(parsed!.keyId).toBe(keyId)
  })

  it('returns null for missing header', () => {
    expect(parseInkV1Header(null)).toBeNull()
  })

  it('returns null for malformed header', () => {
    expect(parseInkV1Header('Bearer abc123')).toBeNull()
    expect(parseInkV1Header('Ink-v1 bad')).toBeNull()
  })

  it('returns null for expired timestamp (>5 min old)', () => {
    const { keyId, privateKeyB64 } = makeTestKeypair()
    const oldTs = Date.now() - 6 * 60 * 1000
    const header = makeHeader(keyId, privateKeyB64, oldTs)
    expect(parseInkV1Header(header)).toBeNull()
  })
})

describe('verifyInkV1', () => {
  it('returns true for a valid signature', () => {
    const { keyId, privateKeyB64, publicKeyB64 } = makeTestKeypair()
    const header = makeHeader(keyId, privateKeyB64)
    const parsed = parseInkV1Header(header)!
    expect(verifyInkV1(parsed.keyId, parsed.ts, parsed.sig, publicKeyB64)).toBe(true)
  })

  it('returns false for wrong public key', () => {
    const { keyId, privateKeyB64 } = makeTestKeypair()
    const { publicKeyB64: wrongPub } = makeTestKeypair()
    const header = makeHeader(keyId, privateKeyB64)
    const parsed = parseInkV1Header(header)!
    expect(verifyInkV1(parsed.keyId, parsed.ts, parsed.sig, wrongPub)).toBe(false)
  })

  it('returns false for tampered payload', () => {
    const { keyId, privateKeyB64, publicKeyB64 } = makeTestKeypair()
    const header = makeHeader(keyId, privateKeyB64)
    const parsed = parseInkV1Header(header)!
    // Tamper with keyId
    expect(verifyInkV1('0000000000000000000000000000000f', parsed.ts, parsed.sig, publicKeyB64)).toBe(false)
  })
})
