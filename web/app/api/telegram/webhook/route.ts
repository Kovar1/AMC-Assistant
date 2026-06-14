import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Telegram POSTs updates here. We acknowledge with 200 always (a non-200 makes Telegram retry).
// The secret header is set when we register the webhook (scripts/set-telegram-webhook.mjs).
export async function POST(request: Request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: { message?: { text?: string; chat?: { id?: number } } };
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const chatId = update.message?.chat?.id;
  const text = (update.message?.text ?? "").trim();
  if (!chatId) return NextResponse.json({ ok: true });

  const m = /^\/start(?:\s+(\S+))?/.exec(text);
  if (!m || !m[1]) {
    await sendTelegram(
      chatId,
      "Hi! To get AMC drop alerts here, open AMC Assistant → <b>Settings</b> → <b>Connect Telegram</b>.",
    );
    return NextResponse.json({ ok: true });
  }

  const token = m[1];
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("telegram_link_tokens")
    .select("user_id, used_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    await sendTelegram(
      chatId,
      "That link expired or was already used. Open <b>Settings</b> and tap <b>Connect Telegram</b> again.",
    );
    return NextResponse.json({ ok: true });
  }

  await admin.from("profiles").update({ telegram_chat_id: String(chatId) }).eq("id", row.user_id);
  await admin
    .from("telegram_link_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token)
    .is("used_at", null);
  await sendTelegram(
    chatId,
    "✅ Connected! You'll get a ping here when showtimes on your watchlist match your preferences.",
  );
  return NextResponse.json({ ok: true });
}
