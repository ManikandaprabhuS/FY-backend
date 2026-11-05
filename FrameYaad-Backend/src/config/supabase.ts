import { createClient } from "@supabase/supabase-js";

import { env } from "./env";

const serverAuthOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
} as const;

export const createUserSupabaseClient = () =>
  createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, serverAuthOptions);

export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  serverAuthOptions,
);
