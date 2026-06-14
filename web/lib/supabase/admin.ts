import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — BYPASSES RLS. Server-only, never import from a
 * Client Component. Used by the Telegram webhook and the alert cron, which must read
 * and write across all users. Everything user-facing uses lib/supabase/server.ts instead.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
