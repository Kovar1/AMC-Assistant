/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { catalogFeeds, fetchShowtimes } from "@/lib/amc";
import { buildCatalog, buildWatch, posterUrl, FMT_LABEL } from "@/lib/amc-logic";
import { getPrefs, getWatch } from "@/lib/data";
import { addDays, nowET, todayET } from "@/lib/dates";
import { MovieLinks } from "@/components/MovieLinks";
import { WatchButton } from "@/components/WatchButton";

export default async function WatchlistPage() {
  const prefs = await getPrefs();
  const watchRows = await getWatch();
  const watchIds = watchRows.map((w) => w.movie_id);
  const today = todayET();
  const dates = Array.from({ length: prefs.lookaheadDays }, (_, i) => addDays(today, i));

  const [feeds, showtimes] = await Promise.all([catalogFeeds(), fetchShowtimes(prefs.theatres, dates)]);
  const watch = buildWatch(prefs, watchIds, showtimes, buildCatalog(feeds), nowET());
  const rowMeta = new Map(watchRows.map((w) => [w.movie_id, w]));

  return (
    <>
      <h1>Watchlist</h1>
      {watch.length === 0 && (
        <p className="empty">
          Nothing watched yet. Go to <Link href="/movies">Movies</Link> and tap a heart.
        </p>
      )}
      <div className="list">
        {watch.map((w) => {
          const meta = rowMeta.get(w.id);
          const title = w.title || meta?.name || `Movie ${w.id}`;
          const poster = w.poster || meta?.poster || "";
          return (
            <article key={w.id} className={`card watch-card ${w.rerelease ? "rerelease" : ""}`}>
              {poster && (
                <Link className="poster-link" href={`/movie/${w.id}`}>
                  <img className="poster" src={posterUrl(poster, 240)} alt="" loading="lazy" />
                </Link>
              )}
              <div className="card-body">
                <div className="card-head">
                  <h3>
                    <Link className="title-link" href={`/movie/${w.id}`}>{title}</Link>
                  </h3>
                  <WatchButton movieId={w.id} name={title} poster={poster} release={w.release} watched={true} />
                </div>
                <MovieLinks title={title} />
                {w.matches > 0 ? (
                  <>
                    <span className="badge ok">{w.matches} matching</span>
                    {w.shows.map((r, j) => (
                      <div key={j} className={`row ${r.passed ? "past" : ""}`}>
                        <span className="when">{r.when}</span>
                        {r.fmt !== "STANDARD" && <span className={`badge ${r.fmt}`}>{FMT_LABEL[r.fmt]}</span>}
                        <span className="meta">{r.theatre}</span>
                        {r.passed ? (
                          <span className="book-past">Book</span>
                        ) : (
                          <a className="book" href={r.url} target="_blank" rel="noopener">Book</a>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    <span className="badge wait">waiting</span>
                    <p className="empty">No matching showtimes yet{w.release ? ` · releases ${w.release}` : ""}.</p>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
