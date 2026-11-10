import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { createDeleteAccountHandler } from './handler.js'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const publicKey = Deno.env.get('SUPABASE_ANON_KEY')!
const allowedOrigins = (Deno.env.get('ACCOUNT_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean)
if (!supabaseUrl || !serviceKey || !publicKey || !allowedOrigins.length) throw new Error('Account deletion server configuration is incomplete')

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient(supabaseUrl, serviceKey, options)
Deno.serve(createDeleteAccountHandler({
  admin, supabaseUrl, allowedOrigins,
  createVerifier: () => createClient(supabaseUrl, publicKey, options),
}))
