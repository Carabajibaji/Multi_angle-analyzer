"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { href: "/", label: "Today" },
  { href: "/companies", label: "Companies" },
  { href: "/compare", label: "Compare" },
  { href: "/technical-lab", label: "Technical Lab" },
  { href: "/filings", label: "Filings" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/learn", label: "Learn" },
  { href: "/status", label: "Data Status" },
];

export function Nav() {
  const path = usePathname();
  const links = NAV.map((n) => (
    <li key={n.href}>
      <Link href={n.href} aria-current={path === n.href ? "page" : undefined}>
        {n.label}
      </Link>
    </li>
  ));
  return (
    <>
      <nav className="main" aria-label="Main">
        <ul>{links}</ul>
      </nav>
      <details className="mobile-nav">
        <summary aria-label="Open navigation menu">Menu</summary>
        <nav aria-label="Main (mobile)">
          <ul>{links}</ul>
        </nav>
      </details>
    </>
  );
}
