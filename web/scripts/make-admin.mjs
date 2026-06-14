// Grant (or revoke) admin on a signed-up user's profile. Runs as the DB owner, so it's
// allowed past the role-change guard (which only blocks the `authenticated` API role).
//   node --env-file=.env.local scripts/make-admin.mjs you@email.com
//   node --env-file=.env.local scripts/make-admin.mjs you@email.com --revoke
import pg from "pg";

const email = process.argv[2];
const role = process.argv[3] === "--revoke" ? "user" : "admin";
if (!email) {
  console.error("Usage: make-admin.mjs <email> [--revoke]");
  process.exit(1);
}
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(
  "update public.profiles set role=$2 where id = (select id from auth.users where email = lower($1))",
  [email, role],
);
console.log(r.rowCount ? `${email} role -> ${role}.` : `No user found for ${email} (have they signed up?).`);
await c.end();
