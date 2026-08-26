import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authRedirect, isSessionlessPath } from "@/lib/auth-routes";

/**
 * Refreshes the Supabase session on every request and applies the optimistic route guard.
 * (Next.js 16 "proxy" — formerly "middleware".) Real authorization still happens in
 * pages/Server Actions; the proxy is a first-line redirect only.
 */
export async function updateSession(request: NextRequest) {
  // Skip the Supabase round-trip for routes that carry no session (public showtimes API/MCP, cron,
  // Telegram webhook, the OAuth shim). For /api/ paths authRedirect would return null anyway, so
  // the only thing getUser() achieves there is latency; for /.well-known and /oauth, skipping this
  // is what stops an anonymous OAuth client from being redirected to /login.
  if (isSessionlessPath(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: don't run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const dest = authRedirect(request.nextUrl.pathname, !!user);
  if (dest) {
    const url = request.nextUrl.clone();
    url.pathname = dest;
    url.search = "";
    const redirectResponse = NextResponse.redirect(url);
    // carry over any refreshed auth cookies so the session isn't lost on redirect
    supabaseResponse.cookies
      .getAll()
      .forEach((c) => redirectResponse.cookies.set(c));
    return redirectResponse;
  }

  return supabaseResponse;
}
