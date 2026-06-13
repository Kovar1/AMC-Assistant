// Read-only AMC API client. Server-only (uses AMC_VENDOR_KEY). Caching via Next fetch revalidate.
import "server-only";
import type { Movie, Showtime, Theatre } from "@/lib/amc-logic";

const BASE = "https://api.amctheatres.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

type Page<T> = { _embedded?: Record<string, T[]>; _links?: { next?: { href?: string } } };

async function get(path: string, revalidate: number): Promise<unknown> {
  const key = process.env.AMC_VENDOR_KEY;
  if (!key) throw new Error("AMC_VENDOR_KEY is not set");
  const url = path.startsWith("http") ? path : BASE + path;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA, "X-AMC-Vendor-Key": key },
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`AMC ${res.status} for ${path}`);
  return res.json();
}

async function collect<T>(path: string, key: string, revalidate: number, limit?: number): Promise<T[]> {
  let url: string | null = path;
  const items: T[] = [];
  while (url) {
    const page = (await get(url, revalidate)) as Page<T>;
    items.push(...(page._embedded?.[key] ?? []));
    if (limit && items.length >= limit) return items.slice(0, limit);
    url = page._links?.next?.href ?? null;
  }
  return items;
}

export async function theatre(id: number): Promise<{ name?: string }> {
  return (await get(`/v2/theatres/${id}`, 86400)) as { name?: string };
}

export function showtimes(theatreId: number, date: string): Promise<Showtime[]> {
  return collect<Showtime>(`/v2/theatres/${theatreId}/showtimes/${date}?page-size=100`, "showtimes", 600);
}

export function movies(view: "now-playing" | "coming-soon" | "advance"): Promise<Movie[]> {
  return collect<Movie>(`/v2/movies/views/${view}?page-size=60`, "movies", 1800, 60);
}

export function searchTheatres(name: string): Promise<{ id: number; name: string; location?: { city?: string } }[]> {
  return collect(`/v2/theatres?name=${encodeURIComponent(name)}&page-size=30`, "theatres", 600, 30);
}

/** All three movie feeds in parallel (errors -> empty), for building the shared catalog. */
export function catalogFeeds(): Promise<Movie[][]> {
  const views = ["now-playing", "coming-soon", "advance"] as const;
  return Promise.all(views.map((v) => movies(v).catch(() => [] as Movie[])));
}

/** Showtimes for several theatres × dates in parallel. 404 (no showtimes that day) -> []. */
export async function fetchShowtimes(theatres: Theatre[], dates: string[]): Promise<Map<number, Showtime[]>> {
  const out = new Map<number, Showtime[]>(theatres.map((t) => [t.id, []]));
  const tasks: Promise<void>[] = [];
  for (const t of theatres) {
    for (const d of dates) {
      tasks.push(
        showtimes(t.id, d)
          .then((list) => {
            out.get(t.id)!.push(...list);
          })
          .catch(() => {}),
      );
    }
  }
  await Promise.all(tasks);
  return out;
}
