// Live tests for P8b: the multi-tenant alerter. AMC data is injected (synthetic) so matching
// and the claim-before-send dedupe are deterministic; Telegram is mocked. Hits the real DB via
// the service role and cleans up its claudetest+ user. Skips when env is absent (CI).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MovieMeta, Showtime, Theatre } from "@/lib/amc-logic";

const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DB_URL = process.env.SUPABASE_DB_URL ?? "";
const live = Boolean(SUPA_URL && SERVICE_KEY && DB_URL);

vi.mock("@/lib/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telegram")>();
  return { ...actual, sendTelegram: vi.fn(async () => ({ ok: true, status: 200 })) };
});

import { sendTelegram } from "@/lib/telegram";
import { runAlerts } from "@/lib/alerter";
import { POST as cronPost } from "@/app/api/cron/alerts/route";

describe("P8b: cron endpoint auth gate", () => {
  const call = (headers: Record<string, string> = {}) =>
    cronPost(new Request("http://localhost/api/cron/alerts", { method: "POST", headers }));

  it("rejects a request with no bearer secret", async () => {
    expect((await call()).status).toBe(401);
  });
  it("rejects a request with the wrong bearer secret", async () => {
    expect((await call({ authorization: "Bearer nope" })).status).toBe(401);
  });
});

const stamp = Date.now();
const EMAIL = `claudetest+al${stamp}@example.com`;
const PASSWORD = `al-test-${stamp}!`;
const CHAT = 800000000 + (stamp % 1000000);
const T_ID = 99001;
const MID = 4242424;
const SID = 990011;

const showtime: Showtime = {
  id: SID,
  movieId: MID,
  movieName: "Test Movie",
  showDateTimeLocal: "2030-01-04T20:00:00",
  auditorium: 1,
  purchaseUrl: "https://amc.example/book",
  attributes: [],
};
const deps = {
  now: "2000-01-01T00:00:00",
  getShowtimes: async (): Promise<Map<number, Showtime[]>> => new Map([[T_ID, [showtime]]]),
  getCatalog: async (): Promise<Map<number, MovieMeta>> =>
    new Map([[MID, { id: MID, name: "Test Movie", poster: "", release: "", score: 0, intl: false, fanfave: false, playing: true }]]),
};

const theatre: Theatre = { id: T_ID, name: "Test Cinema" };

describe.skipIf(!live)("P8b: multi-tenant alerter", () => {
  let db: pg.Client;
  let admin: SupabaseClient;
  let userId = "";

  beforeAll(async () => {
    db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    await admin.from("allowed_users").insert({ email: EMAIL });
    const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = data.user.id;
    await admin.from("profiles").update({ telegram_chat_id: String(CHAT) }).eq("id", userId);
    await admin
      .from("preferences")
      .update({ theatres: [theatre], formats: [], earliest_hour: 0, lookahead_days: 7, onboarded: true })
      .eq("user_id", userId);
    await admin.from("watchlist").insert({ user_id: userId, movie_id: MID, name: "Test Movie" });
  }, 60000);

  afterAll(async () => {
    await db.query("delete from auth.users where email like 'claudetest+%'");
    await db.query("delete from public.allowed_users where email like 'claudetest+%'");
    await db.end();
  }, 30000);

  beforeEach(() => vi.mocked(sendTelegram).mockClear());

  const countNotified = async () =>
    (await db.query("select count(*)::int n from public.notified where user_id=$1", [userId])).rows[0].n;
  const countAlerts = async () =>
    (await db.query("select count(*)::int n from public.alerts where user_id=$1 and sent", [userId])).rows[0].n;

  it("sends one alert for a new matching watchlist showtime", async () => {
    const r = await runAlerts(deps);
    expect(r.alerts).toBeGreaterThanOrEqual(1);
    expect(vi.mocked(sendTelegram)).toHaveBeenCalledWith(String(CHAT), expect.stringContaining("Test Movie"));
    expect(await countNotified()).toBe(1);
    expect(await countAlerts()).toBe(1);
  }, 30000);

  it("does not re-alert on the next run (claim-before-send dedupe)", async () => {
    const r = await runAlerts(deps);
    expect(vi.mocked(sendTelegram)).not.toHaveBeenCalled();
    expect(r.alerts).toBe(0);
    expect(await countNotified()).toBe(1); // unchanged
  }, 30000);

  it("ignores showtimes already in the past (before `now`)", async () => {
    // a brand-new movie on the watchlist, but its only showtime is before `now`
    const pastMid = MID + 1;
    await admin.from("watchlist").insert({ user_id: userId, movie_id: pastMid, name: "Past Movie" });
    const pastDeps = {
      now: "2031-01-01T00:00:00", // after the showtime below
      getCatalog: deps.getCatalog,
      getShowtimes: async (): Promise<Map<number, Showtime[]>> =>
        new Map([[T_ID, [{ ...showtime, id: SID + 1, movieId: pastMid, showDateTimeLocal: "2030-06-01T20:00:00" }]]]),
    };
    const r = await runAlerts(pastDeps);
    expect(vi.mocked(sendTelegram)).not.toHaveBeenCalled();
    expect(r.alerts).toBe(0);
  }, 30000);
});
