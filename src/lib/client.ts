import { createBrowserClient, parseCookieHeader } from '@supabase/ssr'

export function createBrowserClientWithCookies(url: string, key: string) {
  return createBrowserClient(url, key, {
    cookies: {
      getAll() {
        if (typeof document === 'undefined') return []
        return parseCookieHeader(document.cookie)
      },
    },
  })
}
