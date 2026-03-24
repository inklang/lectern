import type { APIRoute } from 'astro'
import { supabaseAnon } from '../../../lib/supabase.js'

export const GET: APIRoute = async ({ url, redirect }) => {
  const code = url.searchParams.get('code')
  if (code) {
    await supabaseAnon.auth.exchangeCodeForSession(code)
  }
  return redirect('/profile')
}
