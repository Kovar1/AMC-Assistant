// Manage the signup invite list (public.allowed_users).
//   Add:    node --env-file=.env.local scripts/invite.mjs someone@example.com
//   List:   node --env-file=.env.local scripts/invite.mjs --list
//   Remove: node --env-file=.env.local scripts/invite.mjs --remove someone@example.com
import pg from "pg";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL required (run with --env-file=.env.local)");
  process.exit(1);
}
const [arg1, arg2] = process.argv.slice(2);
if (!arg1) {
  console.error("Usage: invite.mjs <email> | --list | --remove <email>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

if (arg1 === "--list") {
  const { rows } = await client.query(
    "select email, invited_at, accepted_at from public.allowed_users order by invited_at",
  );
  for (const r of rows) {
    console.log(`${r.email}  invited ${r.invited_at.toISOString().slice(0, 10)}  ${r.accepted_at ? "ACCEPTED" : "pending"}`);
  }
  if (rows.length === 0) console.log("(invite list is empty)");
} else if (arg1 === "--remove") {
  const res = await client.query("delete from public.allowed_users where email = lower($1)", [arg2]);
  console.log(res.rowCount ? `Removed ${arg2}` : `${arg2} was not on the list`);
} else {
  await client.query(
    "insert into public.allowed_users (email) values (lower($1)) on conflict (email) do nothing",
    [arg1],
  );
  console.log(`Invited ${arg1.toLowerCase()} — they can now sign up.`);
}
await client.end();
