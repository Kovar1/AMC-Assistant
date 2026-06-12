import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/auth-actions";

// Protected home. The AMC board lands here in Phase 4.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main style={{ maxWidth: 640, margin: "48px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif" }}>
      <h1>AMC Assistant</h1>
      <p>Signed in as {user.email}</p>
      <form action={signOut}>
        <button
          style={{ padding: "8px 14px", border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", cursor: "pointer" }}
        >
          Log out
        </button>
      </form>
      <p style={{ color: "#64748b", marginTop: 24 }}>Your movie board lands here in Phase 4.</p>
    </main>
  );
}
