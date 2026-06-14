import { NextResponse } from "next/server";
import { runAlerts } from "@/lib/alerter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Triggered by the GitHub Actions cron (scripts in .github/workflows/alerts.yml). Protected by
// a shared bearer secret so only the scheduler can run it. Accepts GET or POST so either a
// curl POST or a plain scheduler GET works.
async function handle(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await runAlerts();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
