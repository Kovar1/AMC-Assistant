import Link from "next/link";
import { getAlerts } from "@/lib/data";

export default async function AlertsPage() {
  const alerts = await getAlerts();
  return (
    <>
      <h1>Alerts</h1>
      {alerts.length === 0 && (
        <p className="empty">
          No alerts yet. Heart movies on <Link href="/movies">Movies</Link> and connect Telegram in{" "}
          <Link href="/settings">Settings</Link> — you&apos;ll get a ping when matching showtimes drop.
        </p>
      )}
      <div className="list">
        {alerts.map((a) => (
          <article key={a.id} className="card watch-card">
            <div className="card-body">
              <div className="card-head">
                <h3>{a.movie_name ?? "Movie"}</h3>
                {!a.sent && <span className="badge wait">not sent</span>}
              </div>
              <p className="sub">
                {a.theatre_name ? `${a.theatre_name} · ` : ""}
                {new Date(a.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })}
              </p>
              {a.shows.map((s, i) => (
                <div key={i} className="row">
                  <span className="when">{s}</span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
