import { NextResponse } from "next/server";
import { runDailyDigest } from "@/lib/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Triggered once daily by Vercel Cron (see vercel.json). Same bearer-secret pattern as the
// pre-existing /api/cron/alerts, reusing CRON_SECRET — no new secret to provision.
async function handle(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await runDailyDigest();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
