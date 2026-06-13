"use client";

import { useState, useTransition } from "react";
import { toggleWatchAction } from "@/lib/app-actions";

export function WatchButton({
  movieId,
  name,
  poster,
  release,
  watched: initial,
}: {
  movieId: number;
  name: string;
  poster: string;
  release: string;
  watched: boolean;
}) {
  const [watched, setWatched] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`heart ${watched ? "on" : ""}`}
      disabled={pending}
      title={watched ? "Watching" : "Watch"}
      onClick={() =>
        start(async () => {
          setWatched(await toggleWatchAction(movieId, { name, poster, release }));
        })
      }
    >
      {watched ? "♥" : "♡"}
    </button>
  );
}
