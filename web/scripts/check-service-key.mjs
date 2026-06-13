// Diagnostic: is SUPABASE_SERVICE_ROLE_KEY valid? Prints OK/INVALID, never the key itself.
// Run: node --env-file=.env.local scripts/check-service-key.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });
const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
if (error) {
  console.error(`INVALID — admin API rejected the key: ${error.message}`);
  process.exit(1);
}
console.log("OK — service role key works.");
