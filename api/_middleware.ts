import { NextResponse } from 'vercel/edge'

export const config = {
  matcher: '/:path(*)',
}

export default async function middleware(request: Request) {
  const url = new URL(request.url)
  const pathname = url.pathname

  // Only handle root-level paths (single segment)
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length !== 1) {
    return NextResponse.next()
  }

  const segment = segments[0]

  // Reserved paths that shouldn't be treated as usernames
  const reservedPaths = new Set([
    'packages', 'org', 'u', 'blog', 'docs', 'api', 'auth', 'tags',
    'login', 'signup', 'search', 'trending', 'new', 'activity', 'feed',
    'notifications', 'profile', 'cli-auth', 'mfa-verify', 'transfers',
    'intro', 'getting-started', 'running-code', 'first-program',
    'variables', 'data-types', 'operators', 'control-flow', 'functions',
    'parameters', 'classes', 'inheritance', 'arrays', 'maps',
    'stdlib', 'language-reference', 'examples', 'webhooks',
    'index', 'favicon', 'robots', 'sitemap', '_next', 'static'
  ])

  // Skip if reserved path
  if (reservedPaths.has(segment.toLowerCase())) {
    return NextResponse.next()
  }

  // Skip if contains special characters
  if (/[./]/.test(segment)) {
    return NextResponse.next()
  }

  // Check if this is a user (we'd need to call an API or check against a list)
  // For now, redirect to /u/[segment] - the profile page will handle 404 if not a user
  return NextResponse.redirect(new URL(`/u/${segment}`, request.url), 301)
}
