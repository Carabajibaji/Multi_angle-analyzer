"use client";
import { useEffect, useId, useRef, useState } from "react";
import { GLOSSARY_BY_SLUG } from "@/content/glossary";

/** Inline Jargon Buster: opens a definition without leaving the page (Esc or outside click closes). */
export function Term({ slug, children }: { slug: string; children?: React.ReactNode }) {
  const entry = GLOSSARY_BY_SLUG.get(slug);
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);
  if (!entry) return <>{children}</>;
  return (
    <span className="term" ref={ref}>
      <button type="button" className="term-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {children ?? entry.term}
        <span aria-hidden="true" className="term-q">?</span>
      </button>
      {open ? (
        <span id={id} role="dialog" aria-label={`Definition: ${entry.term}`} className="term-pop">
          <strong>{entry.term}</strong>
          <span className="term-row">{entry.plain}</span>
          <span className="term-row"><em>Why investors look at it:</em> {entry.why}</span>
          <span className="term-row"><em>Example (illustrative):</em> {entry.example}</span>
          <span className="term-row"><em>Limitation:</em> {entry.limitation}</span>
          <a href={`/learn#${entry.slug}`} className="tiny">Open in glossary</a>
        </span>
      ) : null}
    </span>
  );
}
