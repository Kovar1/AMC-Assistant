import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const USER_CAP = 25;

/** True only if the logged-in user's profile has role='admin'. Read via the user's own
 *  (RLS-scoped) client, so it can only ever see their own row. */
export async function currentUserIsAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

export type Invite = { email: string; invited_at: string; accepted_at: string | null };
export type AdminUser = {
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  telegram: boolean;
};

/** Privileged overview (service role — bypasses RLS). MUST only be called behind
 *  currentUserIsAdmin() / the /admin page's notFound() gate. */
export async function getAdminOverview(): Promise<{ invites: Invite[]; users: AdminUser[] }> {
  const admin = createAdminClient();
  const { data: invites } = await admin
    .from("allowed_users")
    .select("email, invited_at, accepted_at")
    .order("invited_at");
  const { data: linked } = await admin.from("profiles").select("id").not("telegram_chat_id", "is", null);
  const linkedIds = new Set((linked ?? []).map((p) => p.id));
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const users = (list?.users ?? [])
    .map((u) => ({
      email: u.email ?? "",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      telegram: linkedIds.has(u.id),
    }))
    .sort((a, b) => (b.last_sign_in_at ?? "").localeCompare(a.last_sign_in_at ?? ""));
  return { invites: (invites ?? []) as Invite[], users };
}
