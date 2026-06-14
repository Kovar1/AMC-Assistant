"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/data";
import { botUsername } from "@/lib/telegram";

const TOKEN_TTL_MS = 15 * 60 * 1000;

/** Mint a single-use link token for the current user and return the t.me deep link. */
export async function createTelegramLink(): Promise<string> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const token = randomBytes(24).toString("base64url");
  const { error } = await supabase.from("telegram_link_tokens").insert({
    token,
    user_id: userId,
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });
  if (error) throw error;
  const bot = await botUsername();
  return `https://t.me/${bot}?start=${token}`;
}

/** Disconnect Telegram for the current user (clears their chat id). */
export async function unlinkTelegram(): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ telegram_chat_id: null })
    .eq("id", userId);
  if (error) throw error;
  revalidatePath("/settings");
}
