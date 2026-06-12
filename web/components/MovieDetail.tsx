"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useState } from "react";
import { posterUrl, FMT_LABEL, type Row } from "@/lib/amc-logic";
import { MovieLinks } from "./MovieLinks";

type Detail = {
  movieId: number;
  title: string;
  poster: string;
  rerelease: boolean;
  theatres: { name: string; shows: Row[] }[];
  formats: string[];
};

const TIMES: [string, string][] = [
  ["any", "Any"],
  ["lt17", "Before 5 PM"],
  ["17-20", "5–8 PM"],
  ["ge20", "After 8 PM"],
];

export function MovieDetail({ d }: { d: Detail }) {
  const [time, setTime] = useState("any");
  const [fmts, setFmts] = useState<Set<string>>(new Set());

  const inRange = (h: number) =>
    time === "any" || (time === "lt17" && h < 17) || (time === "17-20" && h >= 17 && h < 20) || (time === "ge20" && h >= 20);
  const visible = (r: Row) => inRange(r.hour ?? 0) && (fmts.size === 0 || fmts.has(r.fmt));
  const toggleFmt = (f: string) =>
    setFmts((s) => {
      const n = new Set(s);
      if (n.has(f)) n.delete(f);
      else n.add(f);
      return n;
    });

  const chipLabel = (r: Row) => `${r.when}${r.fmt !== "STANDARD" ? ` · ${FMT_LABEL[r.fmt]}` : ""}`;

  return (
    <>
      <Link className="back" href="/">&larr; Back</Link>
      <div className={`detail-head ${d.rerelease ? "rerelease" : ""}`}>
        {d.poster && <img className="detail-poster" src={posterUrl(d.poster, 300)} alt="" />}
        <div className="detail-meta">
          <h1>{d.title}</h1>
          {d.rerelease && <span className="badge gold-badge">Re-release</span>}
          <MovieLinks title={d.title} />
        </div>
      </div>

      <div className="filters">
        <div className="filter-row">
          <span className="filter-label">Time</span>
          {TIMES.map(([v, l]) => (
            <button key={v} type="button" className={`fchip ${time === v ? "active" : ""}`} onClick={() => setTime(v)}>{l}</button>
          ))}
        </div>
        {d.formats.length > 0 && (
          <div className="filter-row">
            <span className="filter-label">Format</span>
            {d.formats.map((f) => (
              <button key={f} type="button" className={`fchip ${fmts.has(f) ? "active" : ""}`} onClick={() => toggleFmt(f)}>
                {FMT_LABEL[f as keyof typeof FMT_LABEL] || "Standard"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="theatre-rows">
        {d.theatres.map((t, i) => {
          const rows = t.shows.filter(visible);
          return (
            <section className="theatre-row" key={i}>
              <h3>{t.name}</h3>
              {t.shows.length === 0 ? (
                <p className="empty">No showtimes for this movie here.</p>
              ) : rows.length === 0 ? (
                <p className="empty">No showtimes match these filters.</p>
              ) : (
                <div className="chips">
                  {rows.map((r, j) =>
                    r.passed ? (
                      <span key={j} className="showchip past">{chipLabel(r)}</span>
                    ) : (
                      <a key={j} className="showchip" href={r.url} target="_blank" rel="noopener">{chipLabel(r)}</a>
                    ),
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
