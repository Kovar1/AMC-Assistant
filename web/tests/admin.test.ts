// Live tests for the admin panel: the overview data (service role) and the role gate's
// source of truth (a user reads their own role). Cleans up its claudetest+ user; skips in CI.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DB_URL = process.env.SUPABASE_DB_URL ?? "";
const live = Boolean(SUPA_URL && ANON_KEY && SERVICE_KEY && DB_URL);

import { getAdminOverview } from "@/lib/admin";

const stamp = Date.now();
const EMAIL = `claudetest+adm${stamp}@example.com`;
const PASSWORD = `adm-test-${stamp}!`;

describe.skipIf(!live)("admin panel data + role gate", () => {
  let db: pg.Client;
  let admin: SupabaseClient;
  let authed: SupabaseClient;
  let userId = "";

  beforeAll(async () => {
    db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    await admin.from("allowed_users").insert({ email: EMAIL });
    const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = data.user.id;
    authed = createClient(SUPA_URL, ANON_KEY, { auth: { persistSession: false } });
    const s = await authed.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (s.error) throw s.error;
  }, 60000);

  afterAll(async () => {
    await db.query("delete from auth.users where email like 'claudetest+%'");
    await db.query("delete from public.allowed_users where email like 'claudetest+%'");
    await db.end();
  }, 30000);

  const myRole = async () =>
    (await authed.from("profiles").select("role").eq("id", userId).maybeSingle()).data?.role;

  it("new users default to role 'user' (so the admin gate denies them)", async () => {
    expect(await myRole()).toBe("user");
  });

  it("admin can only be granted server-side, not self-assigned", async () => {
    const r = await authed.from("profiles").update({ role: "admin" }).eq("id", userId);
    expect(r.error).not.toBeNull(); // blocked by the role guard
    expect(await myRole()).toBe("user");
  });

  it("getAdminOverview returns invites and users with login timestamps", async () => {
    const o = await getAdminOverview();
    expect(o.invites.some((i) => i.email === EMAIL)).toBe(true);
    const u = o.users.find((x) => x.email === EMAIL);
    expect(u).toBeTruthy();
    expect(u && "last_sign_in_at" in u).toBe(true);
    expect(typeof u!.telegram).toBe("boolean");
  });

  it("a server-side grant flips the role to admin", async () => {
    await db.query("update public.profiles set role='admin' where id=$1", [userId]);
    expect(await myRole()).toBe("admin");
  });
});
