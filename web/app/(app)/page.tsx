/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { redirect } from "next/navigation";
import { catalogFeeds, fetchShowtimes } from "@/lib/amc";
import { buildBoard, buildCatalog, posterUrl, FMT_LABEL } from "@/lib/amc-logic";
import { getPrefs } from "@/lib/data";
import { addDays, chip, heading, nowET, todayET } from "@/lib/dates";
import { DateChips } from "@/components/DateChips";
import { MovieLinks } from "@/components/MovieLinks";

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const prefs = await getPrefs();
  if (!prefs.onboarded || prefs.theatres.length === 0) redirect("/settings");

  const today = todayET();
  const selected = (await searchParams).date ?? today;

  const [feeds, showtimes] = await Promise.all([catalogFeeds(), fetchShowtimes(prefs.theatres, [selected])]);
  const board = buildBoard(prefs, showtimes, buildCatalog(feeds), selected, nowET());
  const dates = Array.from({ length: prefs.lookaheadDays }, (_, i) => chip(addDays(today, i), i));

  return (
    <>
      <div className="board-top">
        <h1>{heading(selected, today)}</h1>
        <DateChips dates={dates} selected={selected} />
      </div>

      {board.map((t, i) => (
        <div key={i}>
          <h2>{t.name}</h2>
          {t.movies.length === 0 ? (
            <p className="empty">No showtimes after {String(prefs.earliestHour).padStart(2, "0")}:00.</p>
          ) : (
            <div className="grid">
              {t.movies.map((m) => (
                <article key={m.id} className={`card ${m.rerelease ? "rerelease" : ""}`}>
                  {m.poster && (
                    <Link className="poster-link" href={`/movie/${m.id}`}>
                      <img className="poster" src={posterUrl(m.poster, 240)} alt="" loading="lazy" />
                    </Link>
                  )}
                  <div className="card-body">
                    <h3>
                      <Link className="title-link" href={`/movie/${m.id}`}>{m.title}</Link>
                    </h3>
                    <MovieLinks title={m.title} />
                    {m.shows.map((r, j) => (
                      <div key={j} className={`row ${r.passed ? "past" : ""}`}>
                        <span className="when">{r.when}</span>
                        {r.fmt !== "STANDARD" && <span className={`badge ${r.fmt}`}>{FMT_LABEL[r.fmt]}</span>}
                        {r.passed ? (
                          <span className="book-past">Book</span>
                        ) : r.sold ? (
                          <span className="sold">Sold out</span>
                        ) : (
                          <a className="book" href={r.url} target="_blank" rel="noopener">Book</a>
                        )}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
