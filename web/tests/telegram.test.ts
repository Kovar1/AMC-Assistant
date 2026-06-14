// Live tests for P8a: the Telegram webhook + link-token security and the new RLS rules.
// Runs against the real Supabase project in .env.local (needs the service-role key too) and
// cleans up its own claudetest+ users. Skips entirely when those env vars are absent (CI).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
const live = Boolean(SUPA_URL && ANON_KEY && SERVICE_KEY && DB_URL && process.env.TELEGRAM_WEBHOOK_SECRET);

// Never hit the real Telegram API from tests.
vi.mock("@/lib/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telegram")>();
  return { ...actual, sendTelegram: vi.fn(async () => ({ ok: true, status: 200 })) };
});

import { POST } from "@/app/api/telegram/webhook/route";

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
const stamp = Date.now();
const EMAIL = `claudetest+tg${stamp}@example.com`;
const PASSWORD = `tg-test-${stamp}!`;
const CHAT = 700000000 + (stamp % 1000000);

function hook(body: unknown, secret = SECRET) {
  return POST(
    new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(body),
    }),
  );
}
const startMsg = (text: string, chatId = CHAT) => ({ message: { text, chat: { id: chatId } } });

describe.skipIf(!live)("P8a: telegram webhook + link security", () => {
  let db: pg.Client;
  let admin: SupabaseClient;
  let authed: SupabaseClient;
  let userId = "";

  beforeAll(async () => {
    db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    await admin.from("allowed_users").insert({ email: EMAIL });
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
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

  async function mintToken(opts: { expired?: boolean } = {}) {
    const token = `tok_${Math.random().toString(36).slice(2)}`;
    const expires = new Date(Date.now() + (opts.expired ? -1000 : 15 * 60 * 1000)).toISOString();
    await admin.from("telegram_link_tokens").insert({ token, user_id: userId, expires_at: expires });
    return token;
  }
  async function storedChatId() {
    const { rows } = await db.query("select telegram_chat_id from public.profiles where id=$1", [userId]);
    return rows[0].telegram_chat_id as string | null;
  }

  it("rejects a wrong secret header", async () => {
    const res = await hook(startMsg("/start whatever"), "wrong-secret");
    expect(res.status).toBe(401);
  });

  it("ignores an invalid token — stores nothing", async () => {
    const res = await hook(startMsg("/start does-not-exist"));
    expect(res.status).toBe(200);
    expect(await storedChatId()).toBeNull();
  });

  it("ignores an expired token", async () => {
    const token = await mintToken({ expired: true });
    await hook(startMsg(`/start ${token}`));
    expect(await storedChatId()).toBeNull();
  });

  it("links a valid token: stores the chat id and marks the token used", async () => {
    const token = await mintToken();
    const res = await hook(startMsg(`/start ${token}`));
    expect(res.status).toBe(200);
    expect(await storedChatId()).toBe(String(CHAT));
    const { rows } = await db.query("select used_at from public.telegram_link_tokens where token=$1", [token]);
    expect(rows[0].used_at).not.toBeNull();
  });

  it("won't reuse an already-used token", async () => {
    const token = await mintToken();
    await hook(startMsg(`/start ${token}`)); // first use links it
    await db.query("update public.profiles set telegram_chat_id=null where id=$1", [userId]); // reset
    await hook(startMsg(`/start ${token}`)); // reuse attempt
    expect(await storedChatId()).toBeNull();
  });

  it("RLS: a user can mint their own link token", async () => {
    const r = await authed.from("telegram_link_tokens").insert({
      token: `self_${Math.random().toString(36).slice(2)}`,
      user_id: userId,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    expect(r.error).toBeNull();
  });

  it("RLS: a user cannot mint a token for someone else", async () => {
    const r = await authed.from("telegram_link_tokens").insert({
      token: `evil_${stamp}`,
      user_id: "00000000-0000-0000-0000-000000000000",
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    expect(r.error?.code).toBe("42501");
  });

  it("RLS: a user cannot read the notified table", async () => {
    const r = await authed.from("notified").select("user_id");
    expect(r.error).not.toBeNull();
  });

  it("role guard: a user cannot escalate their own role", async () => {
    const r = await authed.from("profiles").update({ role: "admin" }).eq("id", userId);
    expect(r.error).not.toBeNull();
    const { rows } = await db.query("select role from public.profiles where id=$1", [userId]);
    expect(rows[0].role).toBe("user");
  });

  it("a user can still unlink (clear their own chat id)", async () => {
    await db.query("update public.profiles set telegram_chat_id='123' where id=$1", [userId]);
    const r = await authed.from("profiles").update({ telegram_chat_id: null }).eq("id", userId);
    expect(r.error).toBeNull();
    expect(await storedChatId()).toBeNull();
  });
});
