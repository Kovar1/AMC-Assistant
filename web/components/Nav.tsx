"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/auth-actions";

const TABS: [string, string][] = [
  ["/", "Tonight"],
  ["/movies", "Movies"],
  ["/watchlist", "Watchlist"],
  ["/settings", "Settings"],
];

export function Nav() {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="nav">
      <Link className="brand" href="/">AMC</Link>
      <nav>
        {TABS.map(([href, label]) => (
          <Link key={href} href={href} className={isActive(href) ? "active" : ""}>
            {label}
          </Link>
        ))}
      </nav>
      <form className="logout" action={signOut}>
        <button>Log out</button>
      </form>
    </header>
  );
}
