import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Multi-Angle Market Technical Analyzer", template: "%s · Multi-Angle Market Analyzer" },
  description: "Beginner-friendly equity research built on automatically refreshed, source-tracked market and SEC data. Educational only.",
  robots: { index: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#content">
          Skip to content
        </a>
        <header className="top">
          <div className="wrap">
            <Link href="/" className="brand">
              Multi-Angle Market Analyzer
              <small>Research with sources, not hype</small>
            </Link>
            <Nav />
          </div>
        </header>
        <main id="content" className="wrap">
          {children}
        </main>
        <footer className="disclosures">
          <div className="wrap">
            <strong>Important disclosures</strong>
            <ul>
              <li>Educational and informational purposes only. Not personalized investment advice.</li>
              <li>Market data may be delayed; each value shows exactly what kind of data it is and when it was retrieved.</li>
              <li>Past performance does not guarantee future results. Technical signals can fail.</li>
              <li>AI-generated explanations may contain errors and should be checked against the cited sources.</li>
              <li>Filing data reflects the latest officially available reporting period, not necessarily the company&apos;s current condition.</li>
            </ul>
          </div>
        </footer>
      </body>
    </html>
  );
}
