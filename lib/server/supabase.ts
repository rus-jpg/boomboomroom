import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/shared/database.types";
import { supabaseServiceKey, supabaseUrl } from "./env";

let admin: SupabaseClient<Database> | null = null;

export function supabaseAdmin(): SupabaseClient<Database> {
  if (!admin) {
    admin = createClient<Database>(supabaseUrl(), supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
