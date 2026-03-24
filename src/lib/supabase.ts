import { createClient } from '@supabase/supabase-js'

const url = process.env['SUPABASE_URL']
const serviceKey = process.env['SUPABASE_SERVICE_KEY']
const anonKey = process.env['SUPABASE_ANON_KEY']

if (!url || !serviceKey || !anonKey) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_KEY, or SUPABASE_ANON_KEY')
}

// Service client: bypasses RLS, used server-side for publish/auth operations
export const supabase = createClient(url, serviceKey)

// Anon client: used for Auth flows (OAuth sign-in)
export const supabaseAnon = createClient(url, anonKey)
