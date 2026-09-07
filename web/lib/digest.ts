// Daily discovery digest: once a day, tell each linked user what's new (or on limited/special
// engagement) at their saved theatres today. This replaces the old per-showtime watchlist-drop
// alert as the thing the cron actually triggers — that alerter (lib/alerter.ts) is left in place
// but nothing schedules it anymore, since the watchlist it depends on has never been used.
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { catalogFeeds, fetchShowtimes } from "@/lib/amc";
import { buildCatalog, buildDigest, type Digest, type MovieMeta, type Showtime, type Theatre } from "@/lib/amc-logic";
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

export type DigestRunResult = { recipients: number; sent: number };

const DEDUPE_WINDOW_MS = 20 * 60 * 60 * 1000; // < 24h so a legitimate next-day run is never blocked

export function renderDigestMessage(digest: Digest, dateLabel: string): string {
  const lines: string[] = [`<b>\u{1F3AC} New at your theatres — ${esc(dateLabel)}</b>`];
  if (digest.rereleases.length === 0 && digest.newReleases.length === 0) {
    lines.push("", "Nothing new today — just the regular lineup.");
    return lines.join("\n");
  }
  if (digest.rereleases.length > 0) {
    lines.push("", "<b>⭐ Limited &amp; special engagements</b>");
    for (const e of digest.rereleases) lines.push(`• ${esc(e.title)} — ${esc(e.theatres.join(", "))}`);
  }
  if (digest.newReleases.length > 0) {
    lines.push("", "<b>\u{1F195} New releases</b>");
    for (const e of digest.newReleases) lines.push(`• ${esc(e.title)} — ${esc(e.theatres.join(", "))}`);
  }
  return lines.join("\n");
}

/** For every user with linked Telegram and at least one saved theatre, send one daily digest. */
export async function runDailyDigest(deps: DigestDeps = {}): Promise<DigestRunResult> {
  const admin = createAdminClient();
  const today = deps.today ?? todayET();
  const now = deps.now ?? nowET();

  let profileQuery = admin.from("profiles").select("id, telegram_chat_id").not("telegram_chat_id", "is", null);
  if (deps.userIds) profileQuery = profileQuery.in("id", deps.userIds);
  const { data: profs } = await profileQuery;
  const recipients = (profs ?? []) as { id: string; telegram_chat_id: string }[];
  if (recipients.length === 0) return { recipients: 0, sent: 0 };

  const ids = recipients.map((p) => p.id);
  const { data: prefRows } = await admin.from("preferences").select("user_id, theatres").in("user_id", ids);
  const theatresByUser = new Map<string, Theatre[]>();
  for (const r of prefRows ?? []) theatresByUser.set(r.user_id, (r.theatres ?? []) as Theatre[]);

  // Fetch shared showtime + catalog data once across the union of everyone's theatres.
  const theatreById = new Map<number, Theatre>();
  for (const id of ids) for (const t of theatresByUser.get(id) ?? []) theatreById.set(t.id, t);
  const unionTheatres = [...theatreById.values()];
  if (unionTheatres.length === 0) return { recipients: recipients.length, sent: 0 };

  const showtimes = deps.getShowtimes
    ? await deps.getShowtimes(unionTheatres, [today])
    : await fetchShowtimes(unionTheatres, [today]);
  const catalog = deps.getCatalog ? await deps.getCatalog() : buildCatalog(await catalogFeeds());

  // Guard against a duplicate send (e.g. an accidental manual re-trigger the same day), without
  // needing to reason about timezone-vs-UTC day boundaries: just check for a very recent one.
  const { data: recent } = await admin
    .from("alerts")
    .select("user_id")
    .eq("movie_name", "Daily digest")
    .gte("created_at", new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString())
    .in("user_id", ids);
  const alreadySent = new Set((recent ?? []).map((r) => r.user_id));

  const label = dayLabel(today);
  let sent = 0;
  for (const rec of recipients) {
    if (alreadySent.has(rec.id)) continue;
    const userTheatres = theatresByUser.get(rec.id) ?? [];
    if (userTheatres.length === 0) continue;

    const digest = buildDigest(userTheatres, showtimes, catalog, today, now);
    const message = renderDigestMessage(digest, label);
    const res = await sendTelegram(rec.telegram_chat_id, message);
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
  return { recipients: recipients.length, sent };
}
