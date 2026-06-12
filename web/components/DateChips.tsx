"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Chip } from "@/lib/dates";

export function DateChips({ dates, selected }: { dates: Chip[]; selected: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // Center the selected date; animate from the previously-selected date's position.
  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>(".datechip.active");
    if (!active) return;
    const prev = sessionStorage.getItem("boardDate");
    sessionStorage.setItem("boardDate", selected);

    const sr = strip.getBoundingClientRect();
    const center = (el: HTMLElement) => {
      const cr = el.getBoundingClientRect();
      return strip.scrollLeft + (cr.left - sr.left) - (strip.clientWidth - cr.width) / 2;
    };
    const activeLeft = center(active);
    const prevChip = prev && prev !== selected ? strip.querySelector<HTMLElement>(`.datechip[data-iso="${prev}"]`) : null;
    if (prevChip) {
      strip.scrollTo({ left: center(prevChip), behavior: "auto" });
      requestAnimationFrame(() => strip.scrollTo({ left: activeLeft, behavior: "smooth" }));
    } else {
      strip.scrollTo({ left: activeLeft, behavior: "auto" });
    }
  }, [selected]);

  return (
    <div className="dates" ref={ref}>
      {dates.map((d) => (
        <Link key={d.iso} href={`/?date=${d.iso}`} data-iso={d.iso} className={`datechip ${d.iso === selected ? "active" : ""}`}>
          <span className="dow">{d.dow}</span>
          <span className="dnum">{d.day}</span>
        </Link>
      ))}
    </div>
  );
}
