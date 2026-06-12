"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { savePrefs, toggleWatch } from "@/lib/data";
import type { Theatre } from "@/lib/amc-logic";

const FORMATS = ["IMAX", "DOLBY", "XL", "LASER", "STANDARD"];

export async function toggleWatchAction(
  movieId: number,
  meta: { name?: string; poster?: string; release?: string },
): Promise<boolean> {
  const watched = await toggleWatch(movieId, meta);
  revalidatePath("/watchlist");
  revalidatePath("/movies");
  return watched;
}

export async function savePrefsAction(formData: FormData): Promise<void> {
  let theatres: Theatre[] = [];
  try {
    theatres = JSON.parse(String(formData.get("theatres") ?? "[]"));
  } catch {
    theatres = [];
  }
  await savePrefs({
    theatres,
    formats: FORMATS.filter((f) => formData.get(`format-${f}`) === "on"),
    earliestHour: Number(formData.get("earliest_hour") ?? 18),
    weekendsOnly: formData.get("weekends_only") === "on",
    partySize: Math.max(1, Number(formData.get("party_size") ?? 2)),
    lookaheadDays: Math.max(1, Number(formData.get("lookahead_days") ?? 7)),
  });
  redirect("/");
}
