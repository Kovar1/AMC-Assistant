"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useState } from "react";
import { posterUrl, type MovieMeta } from "@/lib/amc-logic";
import { MovieLinks } from "./MovieLinks";
import { WatchButton } from "./WatchButton";

type Item = MovieMeta & { local: boolean };

function Card({ m, watched }: { m: Item; watched: boolean }) {
  return (
    <article className="card poster-card">
      <WatchButton movieId={m.id} name={m.name} poster={m.poster} release={m.release} watched={watched} />
      <Link className="poster-link" href={`/movie/${m.id}`}>
        {m.poster ? (
          <img className="poster" src={posterUrl(m.poster, 400)} alt="" loading="lazy" />
        ) : (
          <div className="poster placeholder">{m.name}</div>
        )}
      </Link>
      <div className="card-body">
        <h3>
          <Link className="title-link" href={`/movie/${m.id}`}>{m.name}</Link>
        </h3>
        {m.local && <span className="badge ok">At your theatre</span>}
        {m.release && <span className="meta">{m.release}</span>}
        <MovieLinks title={m.name} />
      </div>
    </article>
  );
}

export function MoviesBrowser({ now, soon, watched }: { now: Item[]; soon: Item[]; watched: number[] }) {
  const [q, setQ] = useState("");
  const w = new Set(watched);
  const f = (list: Item[]) => list.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()));
  const fnow = f(now);
  const fsoon = f(soon);
  return (
    <>
      <h1>Movies</h1>
      <p className="sub">
        Tap the heart to watch a movie. Movies that leave AMC&apos;s listings for a week drop off automatically.
      </p>
      <input className="search movie-search" placeholder="Search movies…" value={q} onChange={(e) => setQ(e.target.value)} />
      {fnow.length > 0 && (
        <>
          <h2>Now Playing</h2>
          <div className="grid posters">{fnow.map((m) => <Card key={m.id} m={m} watched={w.has(m.id)} />)}</div>
        </>
      )}
      {fsoon.length > 0 && (
        <>
          <h2>Coming Soon</h2>
          <div className="grid posters">{fsoon.map((m) => <Card key={m.id} m={m} watched={w.has(m.id)} />)}</div>
        </>
      )}
      {fnow.length === 0 && fsoon.length === 0 && <p className="empty">No movies match.</p>}
    </>
  );
}
