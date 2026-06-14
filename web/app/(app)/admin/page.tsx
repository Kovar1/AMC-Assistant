import { notFound } from "next/navigation";
import { currentUserIsAdmin, getAdminOverview, USER_CAP } from "@/lib/admin";

export const dynamic = "force-dynamic";

const fmt = (ts: string | null) =>
  ts ? new Date(ts).toLocaleString("en-US", { timeZone: "America/New_York" }) : "—";

export default async function AdminPage() {
  // 404 for anyone who isn't an admin — the page is indistinguishable from a missing route.
  if (!(await currentUserIsAdmin())) notFound();
  const { invites, users } = await getAdminOverview();

  return (
    <>
      <h1>Admin</h1>

      <h2>Users ({users.length} / {USER_CAP})</h2>
      <div className="admin-table cols4">
        <div className="admin-row admin-head">
          <span>Email</span><span>Last login</span><span>Joined</span><span>TG</span>
        </div>
        {users.map((u) => (
          <div key={u.email} className="admin-row">
            <span>{u.email}</span>
            <span>{fmt(u.last_sign_in_at)}</span>
            <span>{fmt(u.created_at)}</span>
            <span>{u.telegram ? "✓" : "—"}</span>
          </div>
        ))}
      </div>

      <h2>Whitelist ({invites.length})</h2>
      <div className="admin-table cols3">
        <div className="admin-row admin-head">
          <span>Email</span><span>Invited</span><span>Status</span>
        </div>
        {invites.map((i) => (
          <div key={i.email} className="admin-row">
            <span>{i.email}</span>
            <span>{fmt(i.invited_at)}</span>
            <span>{i.accepted_at ? "accepted" : "pending"}</span>
          </div>
        ))}
      </div>
    </>
  );
}
