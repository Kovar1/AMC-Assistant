// Per-user data access. All queries run as the authenticated user, so RLS scopes them
// to that user's rows automatically (defense in depth behind explicit checks).
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Prefs, Theatre } from "@/lib/amc-logic";

const DEFAULT_PREFS: Prefs = {
  theatres: [],
  formats: [],
  earliestHour: 18,
  weekendsOnly: false,
  partySize: 2,
  lookaheadDays: 7,
  onboarded: false,
};

export type WatchRow = { movie_id: number; name: string | null; poster: string | null; release: string | null };

export async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not authenticated");
  return data.user.id;
}

export async function getProfile(): Promise<{ telegramLinked: boolean }> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("telegram_chat_id").maybeSingle();
  return { telegramLinked: !!data?.telegram_chat_id };
}

export type AlertRow = {
  id: string;
  movie_name: string | null;
  theatre_name: string | null;
  shows: string[];
  sent: boolean;
  created_at: string;
};

export async function getAlerts(): Promise<AlertRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("alerts")
    .select("id, movie_name, theatre_name, shows, sent, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as AlertRow[];
}

export async function getPrefs(): Promise<Prefs> {
  const supabase = await createClient();
  const { data } = await supabase.from("preferences").select("*").maybeSingle();
  if (!data) return DEFAULT_PREFS;
  return {
    theatres: (data.theatres ?? []) as Theatre[],
    formats: (data.formats ?? []) as string[],
    earliestHour: data.earliest_hour ?? 18,
    weekendsOnly: data.weekends_only ?? false,
    partySize: data.party_size ?? 2,
    lookaheadDays: data.lookahead_days ?? 7,
    onboarded: data.onboarded ?? false,
  };
}

export async function savePrefs(p: {
  theatres: Theatre[];
  formats: string[];
  earliestHour: number;
  weekendsOnly: boolean;
  partySize: number;
  lookaheadDays: number;
}): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("preferences").upsert(
    {
      user_id: userId,
      theatres: p.theatres,
      formats: p.formats,
      earliest_hour: p.earliestHour,
      weekends_only: p.weekendsOnly,
      party_size: p.partySize,
      lookahead_days: p.lookaheadDays,
      onboarded: true,
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

export async function getWatch(): Promise<WatchRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("watchlist")
    .select("movie_id, name, poster, release")
    .order("created_at", { ascending: false });
  return (data ?? []) as WatchRow[];
}

export async function getWatchIds(): Promise<number[]> {
  return (await getWatch()).map((w) => w.movie_id);
}

export async function isWatched(movieId: number): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("watchlist").select("id").eq("movie_id", movieId).maybeSingle();
  return !!data;
}

/** Toggle a movie on/off the watchlist. Returns the new watched state. */
export async function toggleWatch(
  movieId: number,
  meta?: { name?: string; poster?: string; release?: string },
): Promise<boolean> {
  const userId = await requireUserId();
  const supabase = await createClient();
  if (await isWatched(movieId)) {
    await supabase.from("watchlist").delete().eq("movie_id", movieId);
    return false;
  }
  const { error } = await supabase.from("watchlist").insert({
    user_id: userId,
    movie_id: movieId,
    name: meta?.name ?? null,
    poster: meta?.poster ?? null,
    release: meta?.release ?? null,
  });
  if (error) throw error;
  return true;
}
