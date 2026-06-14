// Applies supabase/migrations/*.sql to SUPABASE_DB_URL, then verifies the schema/RLS/triggers.
// Run: node --env-file=.env.local scripts/setup-db.mjs
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, "..", "supabase", "migrations");
const TABLES = ["profiles", "preferences", "watchlist", "allowed_users", "telegram_link_tokens", "notified", "alerts"];
const tick = (b) => (b ? "✓" : "✗");

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL not set. Run: node --env-file=.env.local scripts/setup-db.mjs");
  process.exit(1);
}
if (url.includes("[YOUR-PASSWORD]")) {
  console.error("SUPABASE_DB_URL still has the [YOUR-PASSWORD] placeholder — set your DB password in .env.local.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log("Connected to Postgres.\n");

  // ---- apply migrations (each file in its own transaction) ----
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    process.stdout.write(`Applying ${f} ... `);
    try {
      await client.query("begin");
      await client.query(readFileSync(join(MIGRATIONS, f), "utf8"));
      await client.query("commit");
      console.log("done");
    } catch (e) {
      await client.query("rollback");
      console.error("FAILED\n  " + e.message);
      process.exit(1);
    }
  }

  // ---- verify ----
  let pass = true;
  const check = (label, cond) => {
    pass = pass && cond;
    console.log(`  ${tick(cond)} ${label}`);
  };
  console.log("\nVerification:");

  const tables = new Set(
    (await client.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name = any($1)",
      [TABLES],
    )).rows.map((r) => r.table_name),
  );
  const rls = new Map(
    (await client.query(
      "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any($1)",
      [TABLES],
    )).rows.map((r) => [r.relname, r.relrowsecurity]),
  );
  const policies = new Map(
    (await client.query(
      "select tablename, count(*)::int n from pg_policies where schemaname='public' group by tablename",
    )).rows.map((r) => [r.tablename, r.n]),
  );
  const funcs = new Set(
    (await client.query(
      "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname = any($1)",
      [["handle_new_user", "touch_updated_at", "invite_check", "enforce_invite_only", "guard_profile_role"]],
    )).rows.map((r) => r.proname),
  );
  const triggers = new Set(
    (await client.query(
      "select t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relname='users'",
    )).rows.map((r) => r.tgname),
  );
  const profTriggers = new Set(
    (await client.query(
      "select t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='profiles'",
    )).rows.map((r) => r.tgname),
  );

  for (const t of TABLES) check(`table public.${t}`, tables.has(t));
  for (const t of TABLES) check(`RLS enabled on ${t}`, rls.get(t) === true);
  for (const t of ["profiles", "preferences", "watchlist", "telegram_link_tokens", "alerts"]) check(`${t} has policies`, (policies.get(t) || 0) > 0);
  for (const t of ["allowed_users", "notified"]) check(`${t} locked (0 policies)`, (policies.get(t) || 0) === 0);
  check("trigger on_auth_user_created on auth.users", triggers.has("on_auth_user_created"));
  check("trigger before_user_invite_check on auth.users", triggers.has("before_user_invite_check"));
  check("trigger profiles_guard_role on profiles", profTriggers.has("profiles_guard_role"));
  check("function handle_new_user()", funcs.has("handle_new_user"));
  check("function touch_updated_at()", funcs.has("touch_updated_at"));
  check("function invite_check()", funcs.has("invite_check"));
  check("function enforce_invite_only()", funcs.has("enforce_invite_only"));
  check("function guard_profile_role()", funcs.has("guard_profile_role"));

  await client.end();
  console.log("\n" + (pass ? "ALL CHECKS PASSED — DB is set up correctly." : "SOME CHECKS FAILED."));
  process.exit(pass ? 0 : 1);
}

main().catch(async (e) => {
  console.error("Error:", e.message);
  try { await client.end(); } catch {}
  process.exit(1);
});
