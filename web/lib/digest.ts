// Daily discovery digest: once a day, tell each linked user which movies are new at their saved
// theatres — new meaning "wasn't playing there before", remembered per theatre in lineup_seen —
// and send nothing at all on a day with no additions. This replaces the old per-showtime
// watchlist-drop alert as the thing the cron actually triggers; that alerter (lib/alerter.ts) is
// left in place but nothing schedules it anymore, since the watchlist it depends on has never
// been used.
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { catalogFeeds, fetchShowtimes } from "@/lib/amc";
import {
  buildCatalog,
  buildDigest,
  todaysLineup,
  type Digest,
  type LineupSeen,
  type MovieMeta,
  type Showtime,
  type Theatre,
} from "@/lib/amc-logic";
import { sendTelegram, esc } from "@/lib/telegram";
import { todayET, nowET, dayLabel } from "@/lib/dates";

export type DigestDeps = {
  getCatalog?: () => Promise<Map<number, MovieMeta>>;
  getShowtimes?: (theatres: Theatre[], dates: string[]) => Promise<Map<number, Showtime[]>>;
  now?: string;
  today?: string;
  /** Test-only scope: when set, only these user ids are considered, regardless of who else has
   *  Telegram linked in the shared database. Never set in production — omitting it (the cron's
   *  actual call) covers every linked user, which is the point. */
  userIds?: string[];
};

/** `recorded` is how many (theatre, movie) rows today's lineups wrote to lineup_seen — nonzero
 *  on a quiet day too, which is how a baseline run can be told apart from a failed one. */
export type DigestRunResult = { recipients: number; sent: number; recorded: number };

/** A movie counts as new at a theatre when it was not seen playing there in the last this-many
 *  days. 1 would be the literal "not playing yesterday"; a week also swallows events that run on
 *  select days (a Fathom screening on Sunday and again Wednesday) instead of re-announcing them. */
const LOOKBACK_DAYS = 7;

export function renderDigestMessage(digest: Digest, dateLabel: string): string {
  const lines: string[] = [`<b>\u{1F3AC} New at your theatres — ${esc(dateLabel)}</b>`];
  if (digest.rereleases.length > 0) {
    lines.push("", "<b>⭐ Limited &amp; special engagements</b>");
    for (const e of digest.rereleases) lines.push(`• ${esc(e.title)} — ${esc(e.theatres.join(", "))}`);
  }
  if (digest.newReleases.length > 0) {
    lines.push("", "<b>\u{1F195} New arrivals</b>");
    for (const e of digest.newReleases) lines.push(`• ${esc(e.title)} — ${esc(e.theatres.join(", "))}`);
  }
  return lines.join("\n");
}

type SeenRow = { theatre_id: number; movie_id: number; first_seen: string; last_seen: string };

/** For every user with linked Telegram and at least one saved theatre, send one digest of what is
 *  new at their theatres today — or nothing, when nothing is. Then remember today's lineups. */
export async function runDailyDigest(deps: DigestDeps = {}): Promise<DigestRunResult> {
  const admin = createAdminClient();
  const today = deps.today ?? todayET();
  const now = deps.now ?? nowET();

  let profileQuery = admin.from("profiles").select("id, telegram_chat_id").not("telegram_chat_id", "is", null);
  if (deps.userIds) profileQuery = profileQuery.in("id", deps.userIds);
  const { data: profs } = await profileQuery;
  const recipients = (profs ?? []) as { id: string; telegram_chat_id: string }[];
  if (recipients.length === 0) return { recipients: 0, sent: 0, recorded: 0 };

  const ids = recipients.map((p) => p.id);
  const { data: prefRows } = await admin.from("preferences").select("user_id, theatres").in("user_id", ids);
  const theatresByUser = new Map<string, Theatre[]>();
  for (const r of prefRows ?? []) theatresByUser.set(r.user_id, (r.theatres ?? []) as Theatre[]);

  // Fetch shared showtime + catalog data once across the union of everyone's theatres.
  const theatreById = new Map<number, Theatre>();
  for (const id of ids) for (const t of theatresByUser.get(id) ?? []) theatreById.set(t.id, t);
  const unionTheatres = [...theatreById.values()];
  if (unionTheatres.length === 0) return { recipients: recipients.length, sent: 0, recorded: 0 };

  const showtimes = deps.getShowtimes
    ? await deps.getShowtimes(unionTheatres, [today])
    : await fetchShowtimes(unionTheatres, [today]);
  const catalog = deps.getCatalog ? await deps.getCatalog() : buildCatalog(await catalogFeeds());
  const lineup = todaysLineup(unionTheatres, showtimes, catalog, today);

  // What each theatre has been seen playing so far. This memory is what makes "new" mean "wasn't
  // here before" rather than "released recently" — the old rule, which re-listed the same movies
  // every day for two weeks.
  const { data: seenRows, error: seenError } = await admin
    .from("lineup_seen")
    .select("theatre_id, movie_id, first_seen, last_seen")
    .in("theatre_id", unionTheatres.map((t) => t.id));
  if (seenError) throw new Error(`lineup_seen read failed: ${seenError.message}`);
  const seen: LineupSeen = new Map();
  const firstSeen = new Map<string, string>();
  for (const r of (seenRows ?? []) as SeenRow[]) {
    if (!seen.has(r.theatre_id)) seen.set(r.theatre_id, new Map());
    seen.get(r.theatre_id)!.set(r.movie_id, r.last_seen);
    firstSeen.set(`${r.theatre_id}:${r.movie_id}`, r.first_seen);
  }

  const label = dayLabel(today);
  let sent = 0;
  for (const rec of recipients) {
    const userTheatres = theatresByUser.get(rec.id) ?? [];
    if (userTheatres.length === 0) continue;

    const digest = buildDigest(userTheatres, lineup, seen, catalog, today, now, LOOKBACK_DAYS);
    if (digest.rereleases.length === 0 && digest.newReleases.length === 0) continue; // quiet day: no message

    const res = await sendTelegram(rec.telegram_chat_id, renderDigestMessage(digest, label));
    if (!res.ok && res.status === 403) {
      // user blocked the bot — stop pinging them
      await admin.from("profiles").update({ telegram_chat_id: null }).eq("id", rec.id);
    }
    await admin.from("alerts").insert({
      user_id: rec.id,
      movie_id: null,
      movie_name: "Daily digest",
      theatre_name: null,
      shows: [...digest.rereleases, ...digest.newReleases].map((e) => e.title),
      sent: res.ok,
    });
    if (res.ok) sent++;
  }

  // Remember today's lineups so tomorrow's run can tell what is new. Written after the sends, so a
  // crash mid-run leaves today's additions to be reported next time rather than silently marked
  // seen; a same-day re-run finds last_seen = today and sends nothing. A theatre whose fetch failed
  // has an empty lineup and simply isn't recorded today — the lookback window absorbs the gap.
  const rows: { theatre_id: number; movie_id: number; movie_name: string; first_seen: string; last_seen: string }[] = [];
  for (const [theatreId, movies] of lineup) {
    for (const [movieId, name] of movies) {
      rows.push({
        theatre_id: theatreId,
        movie_id: movieId,
        movie_name: name,
        first_seen: firstSeen.get(`${theatreId}:${movieId}`) ?? today,
        last_seen: today,
      });
    }
  }
  if (rows.length > 0) {
    const { error } = await admin.from("lineup_seen").upsert(rows, { onConflict: "theatre_id,movie_id" });
    if (error) throw new Error(`lineup_seen write failed: ${error.message}`);
  }
  return { recipients: recipients.length, sent, recorded: rows.length };
}
