// Pure AMC logic ported from the original Python core.py — no network, no DB.
// Filtering, formatting, ranking, and view-building. Heavily unit-tested.

export type Attr = { code?: string };
export type Showtime = {
  id: number;
  movieId: number;
  movieName?: string;
  showDateTimeLocal?: string;
  auditorium?: number | string;
  isCanceled?: boolean;
  isSoldOut?: boolean;
  purchaseUrl?: string;
  attributes?: Attr[];
  // AMC returns far more than the board needs. These are used by the public /api/showtimes
  // endpoint, where every value it reports has to be a grounded fact rather than an inference.
  showDateTimeUtc?: string;
  utcOffset?: string;
  theatreId?: number;
  movieUrl?: string;
  runTime?: number;
  mpaaRating?: string;
  genre?: string;
  isAlmostSoldOut?: boolean;
  sellUntilDateTimeUtc?: string;
};
export type Movie = {
  id: number;
  name: string;
  releaseDateUtc?: string;
  score?: number;
  hasScheduledShowtimes?: boolean;
  attributes?: Attr[];
  media?: Record<string, string>;
};
export type Theatre = { id: number; name: string };
export type Prefs = {
  theatres: Theatre[];
  formats: string[];
  earliestHour: number;
  weekendsOnly: boolean;
  partySize: number;
  lookaheadDays: number;
  onboarded: boolean;
};
export type Format = "IMAX" | "DOLBY" | "XL" | "LASER" | "STANDARD";
export type MovieMeta = {
  id: number;
  name: string;
  poster: string;
  release: string;
  score: number;
  intl: boolean;
  fanfave: boolean;
  playing: boolean;
};
export type Row = {
  when: string;
  fmt: Format;
  aud: number | string;
  sold: boolean;
  url: string;
  passed: boolean;
  hour?: number;
  theatre?: string;
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CLOUDINARY = "amc-theatres-res.cloudinary.com/";
export const FORMAT_ORDER: Format[] = ["IMAX", "DOLBY", "XL", "LASER", "STANDARD"];
export const FMT_LABEL: Record<Format, string> = { IMAX: "IMAX", DOLBY: "Dolby", XL: "XL", LASER: "Laser", STANDARD: "" };
// Spelled-out names for the API's text view, where a bare "XL" would not be self-explanatory.
export const FMT_FULL_LABEL: Record<Format, string> = {
  IMAX: "IMAX at AMC",
  DOLBY: "Dolby Cinema at AMC",
  XL: "BigD / XL",
  LASER: "Laser at AMC",
  STANDARD: "Standard",
};

export function fmt(s: Showtime): Format {
  const codes = (s.attributes ?? []).map((a) => a.code ?? "").join(" ");
  if (codes.includes("IMAX")) return "IMAX";
  if (codes.includes("DOLBYCINEMA")) return "DOLBY";
  if (codes.includes("XL")) return "XL";
  if (codes.includes("LASERATAMC")) return "LASER";
  return "STANDARD";
}

function weekday(localDate: string): number {
  const [y, m, d] = localDate.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun .. 6=Sat (TZ-safe)
}

export function matches(s: Showtime, p: Prefs): boolean {
  if (s.isCanceled) return false;
  if (p.formats.length && !p.formats.includes(fmt(s))) return false;
  const local = s.showDateTimeLocal ?? "";
  if (local.length < 16 || Number(local.slice(11, 13)) < p.earliestHour) return false;
  if (p.weekendsOnly) {
    const wd = weekday(local);
    if (wd !== 0 && wd !== 6) return false; // not Sat/Sun
  }
  return true;
}

export function clock(local: string): string {
  const h = Number(local.slice(11, 13));
  const m = local.slice(14, 16);
  return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

export function pretty(local: string, withDate = false): string {
  if (!withDate) return clock(local);
  const [y, m, d] = local.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[dt.getUTCDay()]} ${MON[m - 1]} ${d} · ${clock(local)}`;
}

export function poster(movie: Movie): string {
  const media = movie.media ?? {};
  return media.posterDynamic || media.heroDesktopDynamic || "";
}

export function posterUrl(url: string | null | undefined, width: number): string {
  if (!url || !url.includes(CLOUDINARY)) return url || "";
  return url.replace(CLOUDINARY, `${CLOUDINARY}w_${width},f_auto,q_auto/`);
}

export function showRow(s: Showtime, opts: { withDate?: boolean; now?: string | null } = {}): Row {
  const local = s.showDateTimeLocal ?? "";
  return {
    when: pretty(local, opts.withDate ?? false),
    fmt: fmt(s),
    aud: s.auditorium ?? "?",
    sold: !!s.isSoldOut,
    url: s.purchaseUrl ?? "",
    passed: !!(opts.now && local && local < opts.now),
  };
}

/** Build the shared movie catalog (id -> metadata) from the AMC feed arrays. */
export function buildCatalog(feeds: Movie[][]): Map<number, MovieMeta> {
  const cat = new Map<number, MovieMeta>();
  for (const feed of feeds) {
    for (const m of feed) {
      const codes = new Set((m.attributes ?? []).map((a) => a.code));
      cat.set(m.id, {
        id: m.id,
        name: m.name,
        poster: poster(m),
        release: (m.releaseDateUtc ?? "").slice(0, 10),
        score: m.score ?? 0,
        intl: codes.has("INTFILMS"),
        fanfave: codes.has("FANFAVES"),
        playing: !!m.hasScheduledShowtimes,
      });
    }
  }
  return cat;
}

/** Days between a release date and `now`. Null when release is unknown. Negative for a future
 *  (advance/preview) release date. */
function daysSinceRelease(release: string | undefined, now: string): number | null {
  if (!release) return null;
  return (new Date(now).getTime() - new Date(release).getTime()) / 86400000;
}

export function isRerelease(release: string | undefined, now: string): boolean {
  const days = daysSinceRelease(release, now);
  return days !== null && days > 365;
}

/** At-your-theatre first (1000 tier), then popularity score, +0.15 fan-fave, -0.15 international. */
export function relevanceScore(meta: MovieMeta | undefined, id: number, localIds: Set<number>): number {
  let score = meta?.score ?? 0;
  if (meta?.fanfave) score += 0.15;
  if (meta?.intl) score -= 0.15;
  return (localIds.has(id) ? 1000 : 0) + score;
}

export function movieGrid(catalog: Map<number, MovieMeta>, localIds: Set<number>) {
  const items = [...catalog.values()].map((m) => ({ ...m, local: localIds.has(m.id) }));
  const key = (m: MovieMeta) => relevanceScore(m, m.id, localIds);
  const now = items.filter((m) => m.playing).sort((a, b) => key(b) - key(a));
  const soon = items.filter((m) => !m.playing).sort((a, b) => key(b) - key(a));
  return { now, soon };
}

export type BoardMovie = { id: number; title: string; poster: string; rerelease: boolean; shows: Row[] };
export type BoardTheatre = { name: string; movies: BoardMovie[] };

export function buildBoard(
  prefs: Prefs,
  showtimesByTheatre: Map<number, Showtime[]>,
  catalog: Map<number, MovieMeta>,
  day: string,
  now: string,
): BoardTheatre[] {
  const empty = new Set<number>(); // board movies are all local; rank by score only
  const rank = (id: number) => relevanceScore(catalog.get(id), id, empty);
  return prefs.theatres.map((t) => {
    const grouped = new Map<string, { title: string; mid: number; shows: Showtime[] }>();
    for (const s of showtimesByTheatre.get(t.id) ?? []) {
      const local = s.showDateTimeLocal ?? "";
      if (local.startsWith(day) && !s.isCanceled && Number(local.slice(11, 13)) >= prefs.earliestHour) {
        const k = `${s.movieName ?? "?"}::${s.movieId}`;
        if (!grouped.has(k)) grouped.set(k, { title: s.movieName ?? "?", mid: s.movieId, shows: [] });
        grouped.get(k)!.shows.push(s);
      }
    }
    const movies: BoardMovie[] = [...grouped.values()].map((g) => {
      g.shows.sort((a, b) => (a.showDateTimeLocal ?? "").localeCompare(b.showDateTimeLocal ?? ""));
      const meta = catalog.get(g.mid);
      return {
        id: g.mid,
        title: g.title,
        poster: meta?.poster ?? "",
        rerelease: isRerelease(meta?.release, now),
        shows: g.shows.map((s) => showRow(s, { now })),
      };
    });
    movies.sort((a, b) => rank(b.id) - rank(a.id));
    return { name: t.name, movies };
  });
}

export type DigestEntry = { id: number; title: string; theatres: string[] };
export type Digest = { rereleases: DigestEntry[]; newReleases: DigestEntry[] };
/** One day's lineups: theatreId -> movieId -> title. */
export type Lineup = Map<number, Map<number, string>>;
/** Digest memory: theatreId -> movieId -> the last date (YYYY-MM-DD) that movie was seen playing
 *  there. A theatre absent from the map has never been recorded at all. */
export type LineupSeen = Map<number, Map<number, string>>;

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The movies actually playing at each theatre on `today` (canceled showtimes ignored). Every
 *  theatre gets an entry, empty when nothing is scheduled. Titles prefer the catalog, then the
 *  showtime's own movieName. */
export function todaysLineup(
  theatres: Theatre[],
  showtimesByTheatre: Map<number, Showtime[]>,
  catalog: Map<number, MovieMeta>,
  today: string,
): Lineup {
  const lineup: Lineup = new Map();
  for (const t of theatres) {
    const movies = new Map<number, string>();
    for (const s of showtimesByTheatre.get(t.id) ?? []) {
      const local = s.showDateTimeLocal ?? "";
      if (s.isCanceled || !local.startsWith(today) || movies.has(s.movieId)) continue;
      movies.set(s.movieId, catalog.get(s.movieId)?.name ?? s.movieName ?? `Movie ${s.movieId}`);
    }
    lineup.set(t.id, movies);
  }
  return lineup;
}

/**
 * Daily "what's new" digest for a theatre set. A movie is new at a theatre when it is in today's
 * lineup there but was not seen playing there on any of the previous `lookbackDays` days — so a
 * movie mid-run is never repeated, and one that returns after a short gap (a Fathom-style event
 * on select days) is not re-announced either. Release dates play no part in what counts as new;
 * they only split the result into limited/special engagements (re-releases, >365 days since
 * original release — the board's rerelease rule) and everything else.
 *
 * A theatre with no memory at all (absent from `seen`) contributes nothing: its first recorded
 * day is the baseline, not a list of twenty "new" movies.
 */
export function buildDigest(
  theatres: Theatre[],
  lineup: Lineup,
  seen: LineupSeen,
  catalog: Map<number, MovieMeta>,
  today: string,
  now: string,
  lookbackDays = 7,
): Digest {
  const cutoff = shiftDate(today, -lookbackDays); // seen on/after this => still just "playing"
  const byMovie = new Map<number, DigestEntry>();
  for (const t of theatres) {
    const seenHere = seen.get(t.id);
    if (!seenHere) continue;
    for (const [movieId, title] of lineup.get(t.id) ?? []) {
      const last = seenHere.get(movieId);
      if (last !== undefined && last >= cutoff) continue;
      const entry = byMovie.get(movieId) ?? { id: movieId, title, theatres: [] };
      if (!entry.theatres.includes(t.name)) entry.theatres.push(t.name);
      byMovie.set(movieId, entry);
    }
  }

  const rereleases: DigestEntry[] = [];
  const newReleases: DigestEntry[] = [];
  for (const entry of byMovie.values()) {
    entry.theatres.sort();
    (isRerelease(catalog.get(entry.id)?.release, now) ? rereleases : newReleases).push(entry);
  }
  const release = (e: DigestEntry) => catalog.get(e.id)?.release ?? "";
  rereleases.sort((a, b) => a.title.localeCompare(b.title));
  newReleases.sort((a, b) => release(b).localeCompare(release(a)) || a.title.localeCompare(b.title));
  return { rereleases, newReleases };
}

export type WatchCard = {
  id: number;
  title: string;
  poster: string;
  release: string;
  rerelease: boolean;
  matches: number;
  shows: Row[];
};

export function buildWatch(
  prefs: Prefs,
  watchIds: number[],
  showtimesByTheatre: Map<number, Showtime[]>,
  catalog: Map<number, MovieMeta>,
  now: string,
): WatchCard[] {
  const localIds = new Set<number>();
  for (const list of showtimesByTheatre.values()) for (const s of list) localIds.add(s.movieId);
  const sortedIds = [...watchIds].sort(
    (a, b) => relevanceScore(catalog.get(b), b, localIds) - relevanceScore(catalog.get(a), a, localIds),
  );
  return sortedIds.map((mid) => {
    const meta = catalog.get(mid);
    const hits: { s: Showtime; tName: string }[] = [];
    for (const t of prefs.theatres) {
      for (const s of showtimesByTheatre.get(t.id) ?? []) {
        if (s.movieId === mid && matches(s, prefs)) hits.push({ s, tName: t.name });
      }
    }
    hits.sort((a, b) => (a.s.showDateTimeLocal ?? "").localeCompare(b.s.showDateTimeLocal ?? ""));
    const shows = hits.slice(0, 8).map(({ s, tName }) => ({ ...showRow(s, { withDate: true, now }), theatre: tName }));
    return {
      id: mid,
      title: meta?.name ?? hits[0]?.s.movieName ?? `Movie ${mid}`,
      poster: meta?.poster ?? "",
      release: meta?.release ?? "",
      rerelease: isRerelease(meta?.release, now),
      matches: hits.length,
      shows,
    };
  });
}

export function buildMovieDetail(
  prefs: Prefs,
  showtimesByTheatre: Map<number, Showtime[]>,
  movieId: number,
  catalog: Map<number, MovieMeta>,
  now: string,
) {
  const meta = catalog.get(movieId);
  let title = meta?.name;
  const present = new Set<Format>();
  const theatres = prefs.theatres.map((t) => {
    const shows = (showtimesByTheatre.get(t.id) ?? [])
      .filter((s) => s.movieId === movieId && !s.isCanceled)
      .sort((a, b) => (a.showDateTimeLocal ?? "").localeCompare(b.showDateTimeLocal ?? ""));
    const rows = shows.map((s) => {
      const r = showRow(s, { withDate: true, now });
      present.add(r.fmt);
      title = title || s.movieName;
      return { ...r, hour: Number((s.showDateTimeLocal ?? "").slice(11, 13)) };
    });
    return { name: t.name, shows: rows };
  });
  return {
    movieId,
    title: title || `Movie ${movieId}`,
    poster: meta?.poster ?? "",
    rerelease: isRerelease(meta?.release, now),
    theatres,
    formats: FORMAT_ORDER.filter((f) => present.has(f)),
  };
}
