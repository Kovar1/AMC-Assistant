"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuthState } from "@/lib/auth-routes";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Invalid email or password." };
  redirect("/");
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || password.length < 8) {
    return { error: "Enter a valid email and a password of at least 8 characters." };
  }

  const supabase = await createClient();

  // Friendly pre-check; the BEFORE INSERT trigger on auth.users is the real enforcement.
  const { data: allowed } = await supabase.rpc("invite_check", { check_email: email });
  if (allowed === false) return { error: "That email isn't on the invite list yet." };

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${SITE}/auth/confirm?next=/` },
  });
  if (error) {
    if (/allow|invite|not.*permitted/i.test(error.message)) {
      return { error: "That email isn't on the invite list yet." };
    }
    // GoTrue wraps trigger exceptions (invite list, user cap) as a generic DB error.
    if (/database error/i.test(error.message)) {
      return { error: "Signup was blocked by the server. If you were invited, contact the admin." };
    }
    return { error: error.message };
  }
  if (data.session) redirect("/"); // email confirmation disabled -> straight in
  return { message: "Check your email to confirm your account, then log in." };
}

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email." };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${SITE}/auth/confirm?next=/update-password`,
  });
  // Always the same response — don't reveal whether an account exists.
  return { message: "If that email has an account, a reset link is on its way." };
}

export async function updatePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
