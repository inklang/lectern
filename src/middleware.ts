import { defineMiddleware } from 'astro:middleware'
import { supabase } from '~/lib/supabase.js'

// Paths that should NOT be treated as usernames
const RESERVED_PATHS = new Set([
  'packages', 'org', 'u', 'blog', 'docs', 'api', 'auth', 'tags',
  'login', 'signup', 'search', 'trending', 'new', 'activity', 'feed',
  'notifications', 'profile', 'cli-auth', 'mfa-verify', 'transfers',
  'intro', 'getting-started', 'running-code', 'first-program',
  'variables', 'data-types', 'operators', 'control-flow', 'functions',
  'parameters', 'classes', 'inheritance', 'arrays', 'maps',
  'stdlib', 'language-reference', 'examples', 'webhooks',
  'index', 'favicon', 'robots', 'sitemap'
])

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname

  // Only handle root-level paths (single segment)
  if (!pathname.startsWith('/') || pathname.split('/').filter(Boolean).length !== 1) {
    return next()
  }

  // Extract the potential username (first segment)
  const segment = pathname.slice(1) // Remove leading '/'

  // Skip if it's a reserved path, empty, or contains special characters
  if (!segment || RESERVED_PATHS.has(segment.toLowerCase()) || /[./]/.test(segment)) {
    return next()
  }

  // Check if this is a user (case-insensitive query)
  const { data: user } = await supabase
    .from('users')
    .select('user_name')
    .ilike('user_name', segment)
    .single()

  if (user) {
    // User exists, redirect to their profile using the correct casing from DB
    return context.redirect(`/u/${user.user_name}`, 301)
  }

  // Not a user, let the rest of the routing handle it
  return next()
})
