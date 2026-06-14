"use client";

import { useState, useTransition } from "react";
import { createTelegramLink, unlinkTelegram } from "@/lib/telegram-actions";

export function TelegramConnect({ linked }: { linked: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function connect() {
    setErr("");
    start(async () => {
      try {
        const url = await createTelegramLink();
        window.open(url, "_blank", "noopener");
      } catch {
        setErr("Couldn't create a link. Try again.");
      }
    });
  }

  function unlink() {
    setErr("");
    start(async () => {
      try {
        await unlinkTelegram();
      } catch {
        setErr("Couldn't unlink. Try again.");
      }
    });
  }

  return (
    <section>
      <h2>Telegram alerts</h2>
      {linked ? (
        <>
          <p className="sub">✅ Connected. You&apos;ll get a ping when a watchlisted movie&apos;s showtimes match your preferences.</p>
          <button type="button" className="tg-unlink" onClick={unlink} disabled={pending}>
            {pending ? "Working…" : "Unlink Telegram"}
          </button>
        </>
      ) : (
        <>
          <p className="sub">Get a Telegram message the moment a watchlisted movie drops showtimes in your formats and times.</p>
          <button type="button" className="tg-connect" onClick={connect} disabled={pending}>
            {pending ? "Opening Telegram…" : "Connect Telegram"}
          </button>
        </>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}
