import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchTheatres } from "@/lib/amc";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json([], { status: 401 });

  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json([]);

  try {
    const results = await searchTheatres(q);
    return NextResponse.json(results.slice(0, 12).map((t) => ({ id: t.id, name: t.name, city: t.location?.city ?? "" })));
  } catch {
    return NextResponse.json([]);
  }
}
