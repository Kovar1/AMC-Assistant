import { catalogFeeds, fetchShowtimes } from "@/lib/amc";
import { buildCatalog, movieGrid } from "@/lib/amc-logic";
import { getPrefs, getWatchIds } from "@/lib/data";
import { addDays, todayET } from "@/lib/dates";
import { MoviesBrowser } from "@/components/MoviesBrowser";

export default async function MoviesPage() {
  const prefs = await getPrefs();
  const today = todayET();
  const dates = Array.from({ length: prefs.lookaheadDays }, (_, i) => addDays(today, i));

  const [feeds, showtimes, watched] = await Promise.all([
    catalogFeeds(),
    fetchShowtimes(prefs.theatres, dates),
    getWatchIds(),
  ]);

  const localIds = new Set<number>();
  for (const list of showtimes.values()) for (const s of list) localIds.add(s.movieId);
  const { now, soon } = movieGrid(buildCatalog(feeds), localIds);

  return <MoviesBrowser now={now} soon={soon} watched={watched} />;
}
