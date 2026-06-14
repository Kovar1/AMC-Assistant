// Register the Telegram webhook. Run once after deploy, and again if the URL or secret changes.
// node --env-file=.env.local scripts/set-telegram-webhook.mjs https://your-app.vercel.app
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const base = process.argv[2];

if (!token || !secret) {
  console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be set (run with --env-file=.env.local).");
  process.exit(1);
}
if (!base) {
  console.error("Usage: set-telegram-webhook.mjs <https-site-url>");
  process.exit(1);
}

const url = `${base.replace(/\/$/, "")}/api/telegram/webhook`;
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message"] }),
});
const body = await res.json();
console.log(body.ok ? `Webhook registered -> ${url}` : `FAILED: ${body.description}`);
process.exit(body.ok ? 0 : 1);
