// Live tests for the daily digest: AMC data is injected (synthetic) so what counts as new is
// deterministic; Telegram is mocked. Hits the real DB via the service role — including the
// lineup_seen memory, under a fake theatre id — and cleans up its claudetest+ user and rows.
// Skips when env is absent (CI). Mirrors tests/alerter.test.ts's pattern.
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
  it("lists rereleases and new arrivals in separate sections", () => {
    const text = renderDigestMessage(
      {
        rereleases: [{ id: 1, title: "Akira", theatres: ["GSP"] }],
        newReleases: [{ id: 2, title: "Fresh Drop", theatres: ["Riverside 9"] }],
      },
      "Mon Jun 15",
    );
    expect(text).toMatch(/special engagements[\s\S]*Akira[\s\S]*New arrivals[\s\S]*Fresh Drop/);
  });
  it("omits a section that has nothing in it", () => {
    const text = renderDigestMessage({ rereleases: [], newReleases: [{ id: 2, title: "Fresh Drop", theatres: ["GSP"] }] }, "Mon Jun 15");
    expect(text).not.toMatch(/special engagements/);
    expect(text).toMatch(/New arrivals[\s\S]*Fresh Drop/);
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
const T_ID = 99002; // not a real AMC theatre: lineup_seen rows under it are ours to create and delete

const theatre: Theatre = { id: T_ID, name: "Test Cinema" };
const day1 = "2030-06-15";
const day2 = "2030-06-16";
const day3 = "2030-06-17";

function catalogWith(entries: [number, Partial<MovieMeta>][]): () => Promise<Map<number, MovieMeta>> {
  return async () =>
    new Map(
      entries.map(([id, over]) => [
        id,
        { id, name: "Movie", poster: "", release: "", score: 0, intl: false, fanfave: false, playing: true, ...over },
      ]),
    );
}

const MOVIES: Record<number, { name: string; release: string }> = {
  10: { name: "Akira", release: "2000-01-01" }, // rerelease
  20: { name: "Fresh Drop", release: "2030-06-10" },
  30: { name: "Brand New", release: "2030-06-16" },
  40: { name: "Old Classic", release: "1999-01-01" }, // rerelease
};

const playing = (ids: number[], day: string): Map<number, Showtime[]> =>
  new Map([
    [
      T_ID,
      ids.map((id, i) => ({
        id: i + 1,
        movieId: id,
        movieName: MOVIES[id].name,
        showDateTimeLocal: `${day}T19:00:00`,
        auditorium: 1,
        purchaseUrl: "",
        attributes: [],
      })),
    ],
  ]);

describe.skipIf(!live)("daily digest (live)", () => {
  let db: pg.Client;
  let admin: SupabaseClient;
  let userId = "";
  let otherAccountsAlertCountBefore = -1;

  beforeAll(async () => {
    db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    await db.query("delete from public.lineup_seen where theatre_id = $1", [T_ID]); // leftovers of an aborted run
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
    await db.query("delete from public.lineup_seen where theatre_id = $1", [T_ID]);
    await db.query("delete from auth.users where email like 'claudetest+%'");
    await db.query("delete from public.allowed_users where email like 'claudetest+%'");
    await db.end();
  }, 30000);

  beforeEach(() => vi.mocked(sendTelegram).mockClear());

  const countDigestAlerts = async () =>
    (await db.query("select count(*)::int n from public.alerts where user_id=$1 and movie_name='Daily digest'", [userId])).rows[0].n;
  const seenRows = async () =>
    (await db.query("select movie_id, first_seen::text, last_seen::text from public.lineup_seen where theatre_id=$1 order by movie_id", [T_ID])).rows;
  const depsFor = (day: string, ids: number[]) => ({
    today: day,
    now: `${day}T12:00:00`,
    userIds: [userId], // isolate from any other Telegram-linked account in the shared live DB
    getShowtimes: async () => playing(ids, day),
    getCatalog: catalogWith(Object.entries(MOVIES).map(([id, m]) => [Number(id), m])),
  });

  it("day 1: a theatre with no memory is recorded as the baseline and nothing is sent", async () => {
    const r = await runDailyDigest(depsFor(day1, [10, 20]));
    expect(r).toEqual({ recipients: 1, sent: 0, recorded: 2 });
    expect(vi.mocked(sendTelegram)).not.toHaveBeenCalled();
    expect(await countDigestAlerts()).toBe(0);
    expect(await seenRows()).toEqual([
      { movie_id: 10, first_seen: day1, last_seen: day1 },
      { movie_id: 20, first_seen: day1, last_seen: day1 },
    ]);
  }, 30000);

  it("day 2: sends one digest naming only the movies that were not playing before", async () => {
    const r = await runDailyDigest(depsFor(day2, [10, 20, 30, 40]));
    expect(r).toEqual({ recipients: 1, sent: 1, recorded: 4 });
    expect(vi.mocked(sendTelegram)).toHaveBeenCalledTimes(1); // exactly one send, no other account touched
    const [chat, text] = vi.mocked(sendTelegram).mock.calls[0] as [string, string];
    expect(chat).toBe(String(CHAT));
    expect(text).toMatch(/special engagements[\s\S]*Old Classic[\s\S]*New arrivals[\s\S]*Brand New/);
    expect(text).not.toMatch(/Akira|Fresh Drop/);
    expect(await countDigestAlerts()).toBe(1);
    expect(await seenRows()).toEqual([
      { movie_id: 10, first_seen: day1, last_seen: day2 }, // first_seen preserved, last_seen advanced
      { movie_id: 20, first_seen: day1, last_seen: day2 },
      { movie_id: 30, first_seen: day2, last_seen: day2 },
      { movie_id: 40, first_seen: day2, last_seen: day2 },
    ]);
  }, 30000);

  it("day 2 again: a same-day re-run finds nothing new and sends nothing", async () => {
    const r = await runDailyDigest(depsFor(day2, [10, 20, 30, 40]));
    expect(r.sent).toBe(0);
    expect(vi.mocked(sendTelegram)).not.toHaveBeenCalled();
    expect(await countDigestAlerts()).toBe(1); // unchanged
  }, 30000);

  it("day 3: the same lineup as yesterday means no message at all", async () => {
    const r = await runDailyDigest(depsFor(day3, [10, 20, 30, 40]));
    expect(r).toEqual({ recipients: 1, sent: 0, recorded: 4 });
    expect(vi.mocked(sendTelegram)).not.toHaveBeenCalled();
    expect(await countDigestAlerts()).toBe(1);
    expect((await seenRows()).every((row) => row.last_seen === day3)).toBe(true);
  }, 30000);
});
