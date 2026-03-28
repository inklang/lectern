import { createClient } from '@supabase/supabase-js'

const url = import.meta.env['SUPABASE_URL'] ?? process.env['SUPABASE_URL']
const secretKey = import.meta.env['SUPABASE_SECRET_KEY'] ?? process.env['SUPABASE_SECRET_KEY']
const publishableKey = import.meta.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['SUPABASE_PUBLISHABLE_KEY']

if (!url || !secretKey || !publishableKey) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_SECRET_KEY, or SUPABASE_PUBLISHABLE_KEY')
}

// Service client: bypasses RLS, used server-side for publish/auth operations
export const supabase = createClient(url, secretKey)

// Publishable client: used for Auth flows (OAuth sign-in)
export const supabaseAnon = createClient(url, publishableKey)
