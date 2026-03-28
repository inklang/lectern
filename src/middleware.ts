import type { MiddlewareHandler } from 'astro'

// Reserved paths that should not be treated as usernames
const RESERVED = new Set([
  'packages', 'org', 'u', 'blog', 'docs', 'api', 'auth', 'tags',
  'login', 'signup', 'search', 'trending', 'new', 'activity', 'feed',
  'notifications', 'profile', 'cli-auth', 'mfa-verify', 'transfers',
  'intro', 'getting-started', 'running-code', 'first-program',
  'variables', 'data-types', 'operators', 'control-flow', 'functions',
  'parameters', 'classes', 'inheritance', 'arrays', 'maps',
  'stdlib', 'language-reference', 'examples', 'webhooks',
  'index', 'favicon', 'robots', 'sitemap', '_next', 'static'
])

export const onRequest: MiddlewareHandler = async (context, next) => {
  const pathname = context.url.pathname
  const segments = pathname.split('/').filter(Boolean)

  // Only handle root-level paths (single segment)
  if (segments.length !== 1) return next()

  const segment = segments[0]
  if (!segment || RESERVED.has(segment.toLowerCase())) {
    return next()
  }

  // Redirect to /u/[username]
  return context.redirect(`/u/${segment}`, 301)
}
