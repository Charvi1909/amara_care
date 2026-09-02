// Browser Supabase client.
//
// This uses the PUBLIC "anon" key. That is expected for Option A (browser talks
// straight to Supabase) — but it is only safe if Row Level Security is enabled
// on every table you expose. Turn RLS on in the Supabase dashboard before
// shipping this anywhere real.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.113.0'

const SUPABASE_URL = 'https://ukeuslsabwjmsnlitwnv.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrZXVzbHNhYndqbXNubGl0d252Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNDMzNTEsImV4cCI6MjEwMzkxOTM1MX0.WFyhRyCblfOadIBjlgi1-7QcABEiMXH9OWuP7iJYooU'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
