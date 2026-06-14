import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { catalogFeeds, fetchShowtimes } from "@/lib/amc";
import {
  buildCatalog,
  matches,
  fmt,
  pretty,
  type MovieMeta,
  type Prefs,
  type Showtime,
  type Theatre,
} from "@/lib/amc-logic";
import { sendTelegram, esc } from "@/lib/telegram";
import { todayET, addDays, nowET } from "@/lib/dates";

const DEFAULT_PREFS: Prefs = {
  theatres: [],
  formats: [],
  earliestHour: 18,
  weekendsOnly: false,
  partySize: 2,
  lookaheadDays: 7,
  onboarded: true,
};

// AMC access is injectable so the matching/dedupe logic can be tested with synthetic data.
export type AlerterDeps = {
  getCatalog?: () => Promise<Map<number, MovieMeta>>;
  getShowtimes?: (theatres: Theatre[], dates: string[]) => Promise<Map<number, Showtime[]>>;
  now?: string;
};

export type AlerterResult = { recipients: number; alerts: number };

/**
 * For every user who has linked Telegram, ping them once per new matching showtime of a
 * watchlisted movie. Showtimes are fetched once across the union of all users' theatres/dates
 * (shared data), then matched per user. Dedupe is claim-before-send via the `notified` table.
 */
export async function runAlerts(deps: AlerterDeps = {}): Promise<AlerterResult> {
  const admin = createAdminClient();
  const now = deps.now ?? nowET();

  // 1. recipients: users with a linked chat
  const { data: profs } = await admin
    .from("profiles")
    .select("id, telegram_chat_id")
    .not("telegram_chat_id", "is", null);
  const recipients = (profs ?? []) as { id: string; telegram_chat_id: string }[];
  if (recipients.length === 0) return { recipients: 0, alerts: 0 };

  const ids = recipients.map((p) => p.id);
  const { data: prefRows } = await admin.from("preferences").select("*").in("user_id", ids);
  const { data: watchRows } = await admin
    .from("watchlist")
    .select("user_id, movie_id, name")
    .in("user_id", ids);

  const prefsByUser = new Map<string, Prefs>();
  for (const r of prefRows ?? []) {
    prefsByUser.set(r.user_id, {
      theatres: (r.theatres ?? []) as Theatre[],
      formats: (r.formats ?? []) as string[],
      earliestHour: r.earliest_hour ?? 18,
      weekendsOnly: r.weekends_only ?? false,
      partySize: r.party_size ?? 2,
      lookaheadDays: r.lookahead_days ?? 7,
      onboarded: r.onboarded ?? false,
    });
  }
  const watchByUser = new Map<string, { movie_id: number; name: string | null }[]>();
  for (const w of watchRows ?? []) {
    const arr = watchByUser.get(w.user_id) ?? [];
    arr.push({ movie_id: w.movie_id, name: w.name });
    watchByUser.set(w.user_id, arr);
  }

  // 2. union of theatres × dates across all users
  const theatreById = new Map<number, Theatre>();
  let maxLookahead = 1;
  for (const id of ids) {
    const p = prefsByUser.get(id) ?? DEFAULT_PREFS;
    for (const t of p.theatres) theatreById.set(t.id, t);
    maxLookahead = Math.max(maxLookahead, p.lookaheadDays);
  }
  const unionTheatres = [...theatreById.values()];
  if (unionTheatres.length === 0) return { recipients: recipients.length, alerts: 0 };
  const today = todayET();
  const dates = Array.from({ length: maxLookahead }, (_, i) => addDays(today, i));

  // 3. fetch shared data once
  const showtimes = deps.getShowtimes
    ? await deps.getShowtimes(unionTheatres, dates)
    : await fetchShowtimes(unionTheatres, dates);
  const catalog = deps.getCatalog ? await deps.getCatalog() : buildCatalog(await catalogFeeds());

  // 4. per user, per watched movie
  let alerts = 0;
  for (const rec of recipients) {
    const prefs = prefsByUser.get(rec.id) ?? DEFAULT_PREFS;
    for (const w of watchByUser.get(rec.id) ?? []) {
      const mid = w.movie_id;
      const cands: { s: Showtime; t: Theatre }[] = [];
      for (const t of prefs.theatres) {
        for (const s of showtimes.get(t.id) ?? []) {
          const local = s.showDateTimeLocal ?? "";
          if (s.movieId === mid && local >= now && matches(s, prefs)) cands.push({ s, t });
        }
      }
      if (cands.length === 0) continue;

      // claim-before-send: insert ignoring conflicts; .select() returns only freshly claimed rows
      const rows = cands.map((c) => ({
        user_id: rec.id,
        movie_id: mid,
        theatre_id: c.t.id,
        showtime_id: c.s.id,
      }));
      const { data: claimed } = await admin
        .from("notified")
        .upsert(rows, { onConflict: "user_id,movie_id,theatre_id,showtime_id", ignoreDuplicates: true })
        .select("theatre_id, showtime_id");
      const claimedSet = new Set((claimed ?? []).map((r) => `${r.theatre_id}:${r.showtime_id}`));
      const fresh = cands.filter((c) => claimedSet.has(`${c.t.id}:${c.s.id}`));
      if (fresh.length === 0) continue;

      // build + send one message per movie
      fresh.sort((a, b) => (a.s.showDateTimeLocal ?? "").localeCompare(b.s.showDateTimeLocal ?? ""));
      const title = catalog.get(mid)?.name || w.name || fresh[0].s.movieName || `Movie ${mid}`;
      const lines = [`<b>${esc(title)}</b> — new showtimes just dropped`];
      const plain: string[] = [];
      for (const { s, t } of fresh.slice(0, 10)) {
        const tag = fmt(s);
        const suffix = tag === "STANDARD" ? "" : ` · ${tag}`;
        const when = pretty(s.showDateTimeLocal ?? "", true);
        lines.push(`• ${when}${suffix} · ${esc(t.name)} — <a href="${s.purchaseUrl ?? ""}">Book</a>`);
        plain.push(`${when}${suffix} · ${t.name}`);
      }
      const res = await sendTelegram(rec.telegram_chat_id, lines.join("\n"));
      if (!res.ok) {
        if (res.status === 403) {
          // user blocked the bot — stop pinging them
          await admin.from("profiles").update({ telegram_chat_id: null }).eq("id", rec.id);
        } else {
          // transient failure — release the claim so the next run retries
          await admin
            .from("notified")
            .delete()
            .eq("user_id", rec.id)
            .eq("movie_id", mid)
            .in("showtime_id", fresh.map((f) => f.s.id));
        }
      }
      await admin.from("alerts").insert({
        user_id: rec.id,
        movie_id: mid,
        movie_name: title,
        theatre_name: fresh.length === 1 ? fresh[0].t.name : `${fresh.length} showtimes`,
        shows: plain,
        sent: res.ok,
      });
      if (res.ok) alerts++;
    }
  }
  return { recipients: recipients.length, alerts };
}
