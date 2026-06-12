import { catalogFeeds, fetchShowtimes } from "@/lib/amc";
import { buildCatalog, buildMovieDetail } from "@/lib/amc-logic";
import { getPrefs } from "@/lib/data";
import { addDays, nowET, todayET } from "@/lib/dates";
import { MovieDetail } from "@/components/MovieDetail";

export default async function MoviePage({ params }: { params: Promise<{ id: string }> }) {
  const movieId = Number((await params).id);
  const prefs = await getPrefs();
  const today = todayET();
  const dates = Array.from({ length: prefs.lookaheadDays }, (_, i) => addDays(today, i));

  const [feeds, showtimes] = await Promise.all([catalogFeeds(), fetchShowtimes(prefs.theatres, dates)]);
  const detail = buildMovieDetail(prefs, showtimes, movieId, buildCatalog(feeds), nowET());

  return <MovieDetail d={detail} />;
}
