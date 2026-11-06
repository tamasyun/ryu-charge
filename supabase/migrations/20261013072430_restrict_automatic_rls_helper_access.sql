-- This function is used by the Supabase automatic-RLS DDL event trigger.
-- It must not be callable through the public Data API as an RPC.
revoke execute on function public.rls_auto_enable()
from public, anon, authenticated;
