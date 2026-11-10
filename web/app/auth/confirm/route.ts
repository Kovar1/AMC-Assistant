import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth-routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Where links in password-reset (and sign-up confirmation) emails land. Logs the person in from
 * the link, then sends them on to `next`.
 *
 * Two link styles:
 * - `?code=`: what Supabase's default email templates produce. The link goes to Supabase first,
 *   which sends the browser here with a one-time code to exchange. It only works in the browser
 *   that asked for the email, because the exchange needs a cookie set at that moment. This is the
 *   style the project actually sends, and the old version of this route didn't handle it, which is
 *   why reset links went to /login?error=link.
 * - `?token_hash=&type=`: what custom templates built on {{ .TokenHash }} produce. Works in any
 *   browser. Kept in case the templates change.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const next = safeNext(params.get("next"));

  if (code || (tokenHash && type)) {
    const supabase = await createClient();
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ type: type!, token_hash: tokenHash! });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
