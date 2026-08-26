// Wiring for GET /api/showtimes: resolve theatres from the bundled index, fan out to AMC for
// showtimes, hand everything to the pure builder. Deliberately imports no Supabase — this endpoint
// is public and stateless, and nothing in its module graph should be able to touch user data.
import "server-only";

import { fetchShowtimesDetailed, type ShowtimesOutcome } from "@/lib/amc";
import { clock } from "@/lib/amc-logic";
import { dayLabel, nowInZone, nowUtc, todayInZone } from "@/lib/dates";
import * as index from "@/lib/theatre-index";
import {
  buildShowtimesPayload,
  defaultAfter,
  resolveDates,
  resolveTheatres,
  type ParsedQuery,
  type ShowtimesPayload,
} from "@/lib/showtimes-api";

export type ShowtimesDeps = {
  getShowtimes?: (ids: number[], dates: string[]) => Promise<Map<number, ShowtimesOutcome>>;
};

export type ServiceResult =
  | { ok: true; payload: ShowtimesPayload }
  | { ok: false; error: string; hint: string };

export async function getShowtimesPayload(
  query: ParsedQuery,
  deps: ShowtimesDeps = {},
): Promise<ServiceResult> {
  const getShowtimes = deps.getShowtimes ?? fetchShowtimesDetailed;

  const resolution = resolveTheatres(query.selector, index);

  // "Today" depends on the zone. Use the first resolved theatre's zone; with none resolved there
  // is nothing to report anyway, so Eastern is a harmless stand-in for echoing the query back.
  const zone = resolution.theatres[0]?.tz ?? "America/New_York";
  const today = todayInZone(zone);

  const dateResult = resolveDates(query.dateToken, query.days, today);
  if (!dateResult.ok) return { ok: false, error: dateResult.error, hint: dateResult.hint };
  const { dates } = dateResult;

  const warnings = [...resolution.warnings];
  const effective: ParsedQuery = { ...query };
  if (effective.afterToken === null) {
    effective.afterToken = defaultAfter(dates, today);
  } else if (effective.afterToken === "now" && !(dates.length === 1 && dates[0] === today)) {
    // "now" against a future date filters nothing; say so rather than let it look like it applied.
    warnings.push(
      `after=now has no effect on a date that is not today — every showtime on ${dates[0]} is still in the future. No showtimes were filtered out by it.`,
    );
    effective.afterToken = "none";
  }

  const ids = resolution.theatres.map((t) => t.id);
  const outcomes = ids.length ? await getShowtimes(ids, dates) : new Map<number, ShowtimesOutcome>();

  const nowByTheatre = new Map<number, string>();
  for (const t of resolution.theatres) nowByTheatre.set(t.id, nowInZone(t.tz));

  const localNow = nowInZone(zone);
  return {
    ok: true,
    payload: buildShowtimesPayload({
      query: effective,
      dates,
      zone,
      generatedAt: localNow,
      generatedAtLabel: `${dayLabel(localNow)} · ${clock(localNow)}`,
      indexGeneratedAt: index.INDEX_GENERATED_AT,
      nowUtc: nowUtc(),
      nowByTheatre,
      theatres: resolution.theatres,
      unresolved: resolution.unresolved,
      resolvedLocation: resolution.resolvedLocation,
      outcomes,
      warnings,
    }),
  };
}
