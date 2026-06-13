// Dev utility: delete throwaway test accounts (email starts with "claudetest+").
// Uses the DB connection (cascades to profiles/preferences/watchlist).
// Run: node --env-file=.env.local scripts/delete-test-users.mjs
import pg from "pg";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const res = await client.query("delete from auth.users where email like 'claudetest+%' returning email");
console.log(`deleted ${res.rowCount} test user(s):`, res.rows.map((r) => r.email));
await client.end();
