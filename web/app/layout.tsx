import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AMC Assistant",
  description: "Your AMC showtimes, watchlist, and one-tap booking.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
