"use client";

import { useEffect, useState } from "react";

// Red folder news (USD, high impact) van deze week — bron: ForexFactory-weekfeed via /api/news.

type NewsEvent = { title: string; date: string; forecast: string; previous: string };

function nyDayLabel(d: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "America/New_York",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

function nyTime(d: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function isSameNyDay(a: Date, b: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  return fmt.format(a) === fmt.format(b);
}

export default function NewsWeek({ compact = false }: { compact?: boolean }) {
  const [events, setEvents] = useState<NewsEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/news")
      .then((r) => r.json())
      .then((j) => !cancelled && setEvents(Array.isArray(j.events) ? j.events : []))
      .catch(() => !cancelled && setEvents([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (events === null) {
    return <div className="h-10 bg-panel border border-edge rounded-xl animate-pulse" aria-hidden />;
  }
  if (events.length === 0) return null;

  const now = new Date();
  const upcoming = events.filter((e) => new Date(e.date).getTime() > now.getTime());
  const next = upcoming[0] ?? null;

  if (compact) {
    if (!next) return null;
    const d = new Date(next.date);
    const today = isSameNyDay(d, now);
    return (
      <p className="text-xs text-muted">
        <span className="text-short font-mono">●</span> Volgend red event:{" "}
        <span className={today ? "text-short font-medium" : "text-paper"}>
          {next.title} — {today ? "vandaag" : nyDayLabel(d)} {nyTime(d)} NY
        </span>
      </p>
    );
  }

  return (
    <div className="border border-edge rounded-xl bg-panel p-4">
      <p className="text-xs text-muted uppercase tracking-wider mb-2.5">
        Red folder news deze week <span className="normal-case">(USD · high impact)</span>
      </p>
      <ul className="space-y-1.5">
        {events.map((e, i) => {
          const d = new Date(e.date);
          const past = d.getTime() < now.getTime();
          const today = isSameNyDay(d, now);
          const isNext = next && e.date === next.date && e.title === next.title;
          return (
            <li key={i} className={`flex items-baseline gap-2 text-sm ${past ? "opacity-40" : ""}`}>
              <span className={`font-mono text-xs shrink-0 w-24 ${today ? "text-short" : "text-muted"}`}>
                {today ? "vandaag" : nyDayLabel(d)} {nyTime(d)}
              </span>
              <span className={isNext ? "text-paper font-medium" : ""}>
                {e.title}
                {isNext && <span className="ml-2 text-[10px] font-mono text-short border border-short/30 bg-short/10 rounded px-1 py-px align-middle">volgende</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
