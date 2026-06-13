// Live security tests: invite-only signup gate + RLS cross-user isolation.
// They run against the real Supabase project from .env.local and clean up after
// themselves (all test data is keyed on claudetest+ emails). When the env vars
// are absent — e.g. in CI, which has no secrets — the whole suite is skipped.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// vitest does not load .env.local on its own.
const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const DB_URL = process.env.SUPABASE_DB_URL ?? "";
const live = Boolean(SUPA_URL && ANON_KEY && DB_URL);

const stamp = Date.now();
const EMAIL_A = `claudetest+a${stamp}@example.com`;
const EMAIL_B = `claudetest+b${stamp}@example.com`;
const EMAIL_UNINVITED = `claudetest+uninvited${stamp}@example.com`;
const PASSWORD = `live-test-${stamp}!`;

const anonClient = () => createClient(SUPA_URL, ANON_KEY, { auth: { persistSession: false } });

describe.skipIf(!live)("live: invite gate + RLS isolation", () => {
  let db: pg.Client;
  let a: SupabaseClient;
  let b: SupabaseClient;
  let aId = "";
  let bId = "";
  let aToken = "";

  beforeAll(async () => {
    db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    await db.query(
      "insert into public.allowed_users (email) values ($1), ($2) on conflict do nothing",
      [EMAIL_A, EMAIL_B],
    );
    a = anonClient();
    b = anonClient();
    const ra = await a.auth.signUp({ email: EMAIL_A, password: PASSWORD });
    const rb = await b.auth.signUp({ email: EMAIL_B, password: PASSWORD });
    if (ra.error || rb.error) {
      throw new Error(`test signup failed: ${ra.error?.message ?? rb.error?.message}`);
    }
    // Email confirmation is disabled, so signUp returns a session immediately.
    if (!ra.data.user || !ra.data.session || !rb.data.user) {
      throw new Error("expected immediate session — is email confirmation enabled again?");
    }
    aId = ra.data.user.id;
    bId = rb.data.user.id;
    aToken = ra.data.session.access_token;
  }, 60000);

  afterAll(async () => {
    await db.query("delete from auth.users where email like 'claudetest+%'");
    await db.query("delete from public.allowed_users where email like 'claudetest+%'");
    await db.end();
  }, 30000);

  it("blocks signup for an email not on the invite list", async () => {
    const { error } = await anonClient().auth.signUp({ email: EMAIL_UNINVITED, password: PASSWORD });
    expect(error).not.toBeNull();
    const r = await db.query("select 1 from auth.users where email = $1", [EMAIL_UNINVITED]);
    expect(r.rowCount).toBe(0);
  }, 20000);

  it("auto-creates profile + preferences for invited signups and marks invite accepted", async () => {
    const profiles = await db.query("select 1 from public.profiles where id = any($1)", [[aId, bId]]);
    expect(profiles.rowCount).toBe(2);
    const prefs = await db.query("select 1 from public.preferences where user_id = any($1)", [[aId, bId]]);
    expect(prefs.rowCount).toBe(2);
    const accepted = await db.query(
      "select 1 from public.allowed_users where email = $1 and accepted_at is not null",
      [EMAIL_A],
    );
    expect(accepted.rowCount).toBe(1);
  }, 20000);

  it("each user sees exactly their own preferences row", async () => {
    const r = await a.from("preferences").select("user_id");
    expect(r.error).toBeNull();
    expect(r.data?.map((row) => row.user_id)).toEqual([aId]);
  }, 20000);

  it("REST id-swap: A's JWT cannot read B's preferences", async () => {
    const res = await fetch(`${SUPA_URL}/rest/v1/preferences?user_id=eq.${bId}&select=user_id`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${aToken}` },
    });
    expect(res.status).toBe(200); // PostgREST answers, but RLS filters the row out
    expect(await res.json()).toEqual([]);
  }, 20000);

  it("A cannot update B's preferences", async () => {
    const r = await a.from("preferences").update({ party_size: 9 }).eq("user_id", bId).select();
    expect(r.data ?? []).toEqual([]); // zero rows matched under RLS
    const check = await db.query("select party_size from public.preferences where user_id = $1", [bId]);
    expect(check.rows[0].party_size).toBe(2); // still the default
  }, 20000);

  it("A cannot insert a watchlist row owned by B", async () => {
    const r = await a.from("watchlist").insert({ user_id: bId, movie_id: 999, name: "Forged" });
    expect(r.error?.code).toBe("42501"); // RLS with-check violation
  }, 20000);

  it("A's own watchlist works and B cannot see it", async () => {
    const ins = await a.from("watchlist").insert({ user_id: aId, movie_id: 123, name: "Mine" });
    expect(ins.error).toBeNull();
    const mine = await a.from("watchlist").select("movie_id");
    expect(mine.data?.map((row) => row.movie_id)).toEqual([123]);
    const theirs = await b.from("watchlist").select("movie_id");
    expect(theirs.error).toBeNull();
    expect(theirs.data).toEqual([]);
  }, 20000);

  it("profiles are private to their owner", async () => {
    const r = await a.from("profiles").select("id");
    expect(r.error).toBeNull();
    expect(r.data?.map((row) => row.id)).toEqual([aId]);
  }, 20000);

  it("the invite list is unreadable even when authenticated", async () => {
    const r = await a.from("allowed_users").select("email");
    expect(r.error).not.toBeNull(); // no grants, no policies — permission denied
  }, 20000);

  it("invite_check() answers without exposing the table", async () => {
    const yes = await anonClient().rpc("invite_check", { check_email: EMAIL_A.toUpperCase() });
    expect(yes.data).toBe(true);
    const no = await anonClient().rpc("invite_check", { check_email: "nobody@example.com" });
    expect(no.data).toBe(false);
  }, 20000);
});
