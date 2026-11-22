import { createClient } from '@supabase/supabase-js'

// These are public browser credentials. Never put a Supabase secret/service-role key here.
const SUPABASE_URL = 'https://syplaszeowumwmsimgui.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_XZx2xYbkQGrb7hePBr57tw_2SUCMbIg'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
