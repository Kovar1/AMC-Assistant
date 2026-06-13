// One-time import of the old single-user state.json into a signed-up user's rows.
// Usage: node --env-file=.env.local scripts/import-state.mjs you@email.com
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node --env-file=.env.local scripts/import-state.mjs <email>");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const state = JSON.parse(readFileSync(join(here, "..", "..", "state.json"), "utf8"));

const theatres = (state.theatres ?? []).map((id) => ({
  id,
  name: state.theatre_names?.[String(id)] ?? `Theatre ${id}`,
}));
const watch = Object.entries(state.movies ?? {})
  .filter(([, m]) => m.watch)
  .map(([id, m]) => ({ movie_id: Number(id), name: m.name ?? null, poster: m.poster ?? null, release: m.release ?? null }));

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query("select id from auth.users where email = $1", [email]);
if (rows.length === 0) {
  console.error(`No user found for ${email}. Sign up in the app first, then re-run.`);
  await client.end();
  process.exit(1);
}
const userId = rows[0].id;

await client.query(
  `update public.preferences set theatres=$2, formats=$3, earliest_hour=$4, weekends_only=$5,
     party_size=$6, lookahead_days=$7, onboarded=true where user_id=$1`,
  [
    userId,
    JSON.stringify(theatres),
    state.formats ?? [],
    state.earliest_hour ?? 18,
    state.weekends_only ?? false,
    state.party_size ?? 2,
    state.lookahead_days ?? 7,
  ],
);

let added = 0;
for (const w of watch) {
  const r = await client.query(
    `insert into public.watchlist (user_id, movie_id, name, poster, release)
       values ($1,$2,$3,$4,$5) on conflict (user_id, movie_id) do nothing`,
    [userId, w.movie_id, w.name, w.poster, w.release],
  );
  added += r.rowCount;
}

console.log(`Imported ${theatres.length} theatre(s), ${state.formats?.length ?? 0} format pref(s), and ${added} watchlist movie(s) for ${email}.`);
await client.end();
