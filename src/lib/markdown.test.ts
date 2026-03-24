import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdown.js'

describe('renderMarkdown', () => {
  it('converts markdown to HTML', async () => {
    const html = await renderMarkdown('# Hello\n\nWorld')
    expect(html).toContain('<h1>Hello</h1>')
    expect(html).toContain('<p>World</p>')
  })

  it('strips script tags', async () => {
    const html = await renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
  })

  it('strips onclick attributes', async () => {
    const html = await renderMarkdown('<a onclick="evil()">click</a>')
    expect(html).not.toContain('onclick')
  })

  it('returns empty string for null input', async () => {
    const html = await renderMarkdown(null)
    expect(html).toBe('')
  })
})
