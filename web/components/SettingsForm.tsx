"use client";

import { useState } from "react";
import { savePrefsAction } from "@/lib/app-actions";
import type { Prefs, Theatre } from "@/lib/amc-logic";

const FORMATS = ["IMAX", "DOLBY", "XL", "LASER", "STANDARD"];
const LABEL: Record<string, string> = { IMAX: "IMAX", DOLBY: "Dolby", XL: "XL", LASER: "Laser", STANDARD: "Standard" };
type Result = { id: number; name: string; city?: string };

export function SettingsForm({ initial }: { initial: Prefs }) {
  const [theatres, setTheatres] = useState<Theatre[]>(initial.theatres);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const isSetup = !initial.onboarded;

  async function search(value: string) {
    setQ(value);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/theatres?q=${encodeURIComponent(value)}`);
      setResults(await res.json());
    } catch {
      setResults([]);
    }
  }
  function add(r: Result) {
    if (!theatres.some((t) => t.id === r.id)) {
      setTheatres([...theatres, { id: r.id, name: r.name + (r.city ? ` · ${r.city}` : "") }]);
    }
    setQ("");
    setResults([]);
  }
  function remove(id: number) {
    setTheatres(theatres.filter((t) => t.id !== id));
  }

  return (
    <form className="settings" action={savePrefsAction}>
      <h1>{isSetup ? "Welcome — set up your AMC" : "Settings"}</h1>
      {isSetup && (
        <p className="sub">Pick your theatres and what you actually want — we&apos;ll only show formats and times that match.</p>
      )}
      <input type="hidden" name="theatres" value={JSON.stringify(theatres)} />

      <section>
        <h2>Your theatres</h2>
        <div className="checks">
          {theatres.map((t) => (
            <span key={t.id} className="check">
              {t.name}
              <button type="button" className="remove" onClick={() => remove(t.id)} title="Remove">✕</button>
            </span>
          ))}
        </div>
        <input className="search" placeholder="Search AMC theatres by name…" value={q} onChange={(e) => search(e.target.value)} />
        <div className="results">
          {results
            .filter((r) => !theatres.some((t) => t.id === r.id))
            .map((r) => (
              <button type="button" key={r.id} className="add-theatre" onClick={() => add(r)}>
                + {r.name}
                {r.city ? ` · ${r.city}` : ""}
              </button>
            ))}
        </div>
      </section>

      <section>
        <h2>Formats you&apos;ll book</h2>
        <p className="sub">Leave all unchecked to accept any format.</p>
        <div className="format-chips">
          {FORMATS.map((f) => (
            <label key={f} className="chip">
              <input type="checkbox" name={`format-${f}`} defaultChecked={initial.formats.includes(f)} /> {LABEL[f]}
            </label>
          ))}
        </div>
      </section>

      <section className="cols">
        <label>
          Earliest showtime
          <select name="earliest_hour" defaultValue={initial.earliestHour}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
            ))}
          </select>
        </label>
        <label>
          Party size
          <input type="number" name="party_size" min={1} max={12} defaultValue={initial.partySize} />
        </label>
        <label>
          Days to look ahead
          <input type="number" name="lookahead_days" min={1} max={30} defaultValue={initial.lookaheadDays} />
        </label>
        <label className="check inline">
          <input type="checkbox" name="weekends_only" defaultChecked={initial.weekendsOnly} /> Weekends only
        </label>
      </section>

      <button className="primary" type="submit">{isSetup ? "Get started" : "Save preferences"}</button>
    </form>
  );
}
