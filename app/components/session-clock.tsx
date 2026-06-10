"use client";

import { useEffect, useState } from "react";

// Live NY-sessieklok: toont New York-tijd en voortgang door het 08:30–12:00 venster.
const OPEN_MIN = 8 * 60 + 30; // 08:30
const CLOSE_MIN = 12 * 60; // 12:00

function nyNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const h = parseInt(get("hour"), 10) % 24;
  const m = parseInt(get("minute"), 10);
  const weekday = get("weekday");
  return {
    label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    minutes: h * 60 + m,
    weekend: weekday === "Sat" || weekday === "Sun",
  };
}

export default function SessionClock({ compact = false }: { compact?: boolean }) {
  const [now, setNow] = useState<ReturnType<typeof nyNow> | null>(null);

  useEffect(() => {
    setNow(nyNow());
    const t = setInterval(() => setNow(nyNow()), 15000);
    return () => clearInterval(t);
  }, []);

  if (!now) return null;

  const open = !now.weekend && now.minutes >= OPEN_MIN && now.minutes < CLOSE_MIN;
  const progress = Math.min(1, Math.max(0, (now.minutes - OPEN_MIN) / (CLOSE_MIN - OPEN_MIN)));

  if (compact) {
    return (
      <div className="flex items-center gap-2 font-mono text-xs" title="New York sessie 08:30–12:00 ET">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            open ? "bg-long animate-pulse" : "bg-muted/50"
          }`}
        />
        <span className={open ? "text-long" : "text-muted"}>NY {now.label}</span>
      </div>
    );
  }

  return (
    <div className="border border-edge rounded-xl bg-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              open ? "bg-long animate-pulse" : "bg-muted/50"
            }`}
          />
          <span className="text-sm font-medium">
            {open ? "NY-sessie live" : now.weekend ? "Weekend — markt dicht" : "Buiten sessievenster"}
          </span>
        </div>
        <span className="font-mono text-sm text-session">{now.label} ET</span>
      </div>
      <div className="relative h-2 rounded-full bg-ink overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${open ? "bg-session" : "bg-edge"}`}
          style={{ width: `${(open ? progress : now.minutes >= CLOSE_MIN ? 1 : 0) * 100}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5 font-mono text-[10px] text-muted">
        <span>08:30 open</span>
        <span>12:00 cutoff</span>
      </div>
    </div>
  );
}
