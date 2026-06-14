import "server-only";

const api = (method: string) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

/** Send an HTML message. Returns the HTTP status so callers can react (e.g. 403 = blocked). */
export async function sendTelegram(
  chatId: string | number,
  html: string,
): Promise<{ ok: boolean; status: number }> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { ok: false, status: 0 };
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  return { ok: res.ok, status: res.status };
}

let cachedUsername: string | null = null;

/** The bot's public @username, for building t.me deep links. Memoized per warm instance. */
export async function botUsername(): Promise<string> {
  if (cachedUsername) return cachedUsername;
  const res = await fetch(api("getMe"));
  const body = await res.json();
  if (!body.ok) throw new Error(`Telegram getMe failed: ${body.description ?? res.status}`);
  cachedUsername = body.result.username as string;
  return cachedUsername;
}

/** Minimal HTML escape for user/movie text interpolated into messages. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
