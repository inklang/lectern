import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

export async function renderMarkdown(input: string | null): Promise<string> {
  if (!input) return ''
  const raw = await marked(input)
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'pre', 'code']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      'a': ['href', 'title', 'target'],
      'img': ['src', 'alt', 'title'],
      'code': ['class'],
    },
  })
}
