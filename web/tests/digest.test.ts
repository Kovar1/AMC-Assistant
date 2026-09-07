// Live tests for the daily digest: AMC data is injected (synthetic) so the new/rerelease split is
// deterministic; Telegram is mocked. Hits the real DB via the service role and cleans up its
// claudetest+ user. Skips when env is absent (CI). Mirrors tests/alerter.test.ts's pattern.
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
import { renderDigestMessage, runDailyDigest } from "@/lib/digest";
import { POST as cronPost } from "@/app/api/cron/digest/route";

describe("digest cron endpoint auth gate", () => {
  const call = (headers: Record<string, string> = {}) =>
    cronPost(new Request("http://localhost/api/cron/digest", { method: "POST", headers }));

  it("rejects a request with no bearer secret", async () => {
    expect((await call()).status).toBe(401);
  });
  it("rejects a request with the wrong bearer secret", async () => {
    expect((await call({ authorization: "Bearer nope" })).status).toBe(401);
  });
});

describe("renderDigestMessage (pure)", () => {
  it("says so plainly when there's nothing new", () => {
    const text = renderDigestMessage({ rereleases: [], newReleases: [] }, "Mon Jun 15");
    expect(text).toMatch(/Nothing new today/);
  });
  it("lists rereleases and new releases in separate sections", () => {
    const text = renderDigestMessage(
      {
        rereleases: [{ id: 1, title: "Akira", theatres: ["GSP"] }],
        newReleases: [{ id: 2, title: "Fresh Drop", theatres: ["Riverside 9"] }],
      },
      "Mon Jun 15",
    );
    expect(text).toMatch(/special engagements[\s\S]*Akira[\s\S]*New releases[\s\S]*Fresh Drop/);
  });
  it("escapes HTML in titles and theatre names", () => {
    const text = renderDigestMessage(
      { rereleases: [], newReleases: [{ id: 1, title: "<script>", theatres: ["A & B"] }] },
      "Mon Jun 15",
    );
    expect(text).not.toContain("<script>");
    expect(text).toContain("&amp; B");
  });
});

const stamp = Date.now();
const EMAIL = `claudetest+dg${stamp}@example.com`;
const PASSWORD = `dg-test-${stamp}!`;
const CHAT = 800000000 + (stamp % 1000000);
const T_ID = 99002;

const theatre: Theatre = { id: T_ID, name: "Test Cinema" };
const today = "2030-06-15";

function catalogWith(entries: [number, Partial<MovieMeta>][]): () => Promise<Map<number, MovieMeta>> {
  return async () =>
    new Map(
      entries.map(([id, over]) => [
        id,
        { id, name: "Movie", poster: "", release: "", score: 0, intl: false, fanfave: false, playing: true, ...over },
      ]),
    );
}

describe.skipIf(!live)("daily digest (live)", () => {
  let db: pg.Client;
  let admin: SupabaseClient;
  let userId = "";
  let otherAccountsAlertCountBefore = -1;

  beforeAll(async () => {
    db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    await admin.from("allowed_users").insert({ email: EMAIL });
    const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = data.user.id;
    await admin.from("profiles").update({ telegram_chat_id: String(CHAT) }).eq("id", userId);
    await admin.from("preferences").update({ theatres: [theatre], onboarded: true }).eq("user_id", userId);

    // Snapshot every OTHER account's alert count before running anything. Regression guard for
    // the real bug this suite caught during development: runDailyDigest, unscoped, queries every
    // Telegram-linked profile in the shared DB — it actually wrote a "Daily digest" row to the
    // real production account the first time this test ran, before userIds existed. Read-only;
    // never touches these rows.
    const before = await db.query("select coalesce(sum(count),0)::int n from (select count(*) from public.alerts where user_id != $1 group by user_id) t", [userId]);
    otherAccountsAlertCountBefore = before.rows[0].n;
  }, 60000);

  afterAll(async () => {
    const after = await db.query("select coalesce(sum(count),0)::int n from (select count(*) from public.alerts where user_id != $1 group by user_id) t", [userId]);
    if (after.rows[0].n !== otherAccountsAlertCountBefore) {
      throw new Error(
        `Isolation regression: some other account's alerts row count changed during this test run ` +
          `(${otherAccountsAlertCountBefore} -> ${after.rows[0].n}). runDailyDigest's userIds scoping may be broken.`,
      );
    }
    await db.query("delete from auth.users where email like 'claudetest+%'");
    await db.query("delete from public.allowed_users where email like 'claudetest+%'");
    await db.end();
  }, 30000);

  beforeEach(() => vi.mocked(sendTelegram).mockClear());

  const countDigestAlerts = async () =>
    (await db.query("select count(*)::int n from public.alerts where user_id=$1 and movie_name='Daily digest'", [userId])).rows[0].n;

  it("sends one digest naming the rerelease and new movie playing at the user's theatre", async () => {
    const deps = {
      today,
      now: `${today}T12:00:00`,
      userIds: [userId], // isolate from any other Telegram-linked account in the shared live DB
      getShowtimes: async (): Promise<Map<number, Showtime[]>> =>
        new Map([
          [
            T_ID,
            [
              { id: 1, movieId: 10, movieName: "Akira", showDateTimeLocal: `${today}T19:00:00`, auditorium: 1, purchaseUrl: "", attributes: [] },
              { id: 2, movieId: 20, movieName: "Fresh Drop", showDateTimeLocal: `${today}T20:00:00`, auditorium: 1, purchaseUrl: "", attributes: [] },
            ],
          ],
        ]),
      getCatalog: catalogWith([
        [10, { name: "Akira", release: "2000-01-01" }], // rerelease
        [20, { name: "Fresh Drop", release: "2030-06-10" }], // new
      ]),
    };
    const r = await runDailyDigest(deps);
    expect(r.sent).toBe(1);
    expect(vi.mocked(sendTelegram)).toHaveBeenCalledWith(
      String(CHAT),
      expect.stringMatching(/Akira[\s\S]*Fresh Drop/),
    );
    expect(vi.mocked(sendTelegram)).toHaveBeenCalledTimes(1); // exactly one send, no other account touched
    expect(await countDigestAlerts()).toBe(1);
  }, 30000);

  it("does not double-send within the dedupe window", async () => {
    const deps = {
      today,
      now: `${today}T12:00:00`,
      userIds: [userId],
      getShowtimes: async (): Promise<Map<number, Showtime[]>> => new Map([[T_ID, []]]),
      getCatalog: catalogWith([]),
    };
    const r = await runDailyDigest(deps);
    expect(r.sent).toBe(0);
    expect(vi.mocked(sendTelegram)).not.toHaveBeenCalled();
    expect(await countDigestAlerts()).toBe(1); // unchanged from the previous test
  }, 30000);
});
