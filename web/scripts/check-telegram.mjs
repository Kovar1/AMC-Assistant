// Validate TELEGRAM_BOT_TOKEN without printing it. Prints only the bot's PUBLIC identity.
// Run: node --env-file=<envfile> scripts/check-telegram.mjs
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.log("TELEGRAM_BOT_TOKEN: not set in this env file");
  process.exit(2);
}
const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
const body = await res.json();
if (!body.ok) {
  console.log(`TELEGRAM_BOT_TOKEN: present but REJECTED by Telegram (${body.description ?? res.status})`);
  process.exit(1);
}
console.log(`OK — token valid. Bot @${body.result.username} (id ${body.result.id}, "${body.result.first_name}")`);
