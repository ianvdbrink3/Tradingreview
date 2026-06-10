"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/lib/supabase/client";

type Msg = { role: "user" | "assistant"; text: string; created_at?: string };

const MAX_HISTORY = 100; // berichten geladen uit de geschiedenis
const MAX_CONTEXT = 30; // berichten meegestuurd naar de coach

const SUGGESTIES = [
  "Wat is engineered liquidity precies?",
  "Hoe bepaal ik mijn precision level voor een entry?",
  "Hoe ga ik om met een verliesreeks?",
  "Waarom alleen traden tussen 08:30 en 12:00 NY?",
];

function dagLabel(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const vandaag = new Date();
  const gisteren = new Date(Date.now() - 86_400_000);
  const zelfde = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (zelfde(d, vandaag)) return "Vandaag";
  if (zelfde(d, gisteren)) return "Gisteren";
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
}

function tijdLabel(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

export default function CoachPage() {
  const [thread, setThread] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Geschiedenis laden
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await createClient()
        .from("coach_messages")
        .select("role, content, created_at")
        .order("created_at", { ascending: false })
        .limit(MAX_HISTORY);
      if (cancelled) return;
      if (!error && data) {
        setThread(
          data
            .reverse()
            .map((r) => ({ role: r.role as "user" | "assistant", text: r.content, created_at: r.created_at }))
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stream afbreken bij wegnavigeren
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [streaming, thread.length, loading]);

  async function send(text: string) {
    const vraag = text.trim();
    if (!vraag || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    const nextThread: Msg[] = [...thread, { role: "user", text: vraag, created_at: new Date().toISOString() }];
    setThread(nextThread);
    setStreaming("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: nextThread.slice(-MAX_CONTEXT).map(({ role, text }) => ({ role, text })),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "De coach reageert niet. Probeer het opnieuw.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setStreaming(full);
      }
      setStreaming("");
      setThread((t) => [...t, { role: "assistant", text: full, created_at: new Date().toISOString() }]);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setThread((t) => t.slice(0, -1)); // user-bericht terugdraaien zodat opnieuw versturen kan
      setInput(vraag);
      setError(e.message || "Er ging iets mis.");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Klantenservice-header */}
      <div className="bg-panel border border-edge rounded-t-xl px-4 py-3 flex items-center gap-3 sticky top-16 z-10">
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-full bg-session/15 border border-session/40 flex items-center justify-center font-mono font-bold text-session">
            J
          </div>
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-long border-2 border-panel" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-tight">Coach</p>
          <p className="text-xs text-muted leading-tight">Online · vraag alles over de methode</p>
        </div>
      </div>

      {/* Berichten */}
      <div className="bg-ink/40 border-x border-edge px-4 py-5 min-h-[50vh] space-y-4">
        {loading && (
          <div className="space-y-4" aria-hidden>
            <div className="h-12 w-3/5 bg-panel border border-edge rounded-2xl animate-pulse" />
            <div className="h-12 w-2/5 bg-edge/40 border border-edge rounded-2xl animate-pulse ml-auto" />
            <div className="h-20 w-4/5 bg-panel border border-edge rounded-2xl animate-pulse" />
          </div>
        )}

        {!loading && thread.length === 0 && (
          <div className="text-center py-6">
            <p className="text-sm text-muted mb-1">Stel je eerste vraag aan je coach.</p>
            <p className="text-xs text-muted mb-5">
              Over engineered liquidity, precision levels, mindset, risk — alles behalve live entries.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIES.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={busy}
                  className="text-xs bg-panel border border-edge rounded-full px-3 py-1.5 text-muted hover:text-paper hover:border-session/60 transition disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {thread.map((m, i) => {
          const labelNodig = i === 0 || dagLabel(m.created_at) !== dagLabel(thread[i - 1]?.created_at);
          return (
            <div key={i}>
              {labelNodig && m.created_at && (
                <p className="text-center text-[11px] text-muted my-4">{dagLabel(m.created_at)}</p>
              )}
              {m.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[85%] bg-session/15 border border-session/30 rounded-2xl rounded-br-md px-4 py-2.5">
                    <p className="text-sm whitespace-pre-wrap">{m.text}</p>
                    <p className="text-[10px] text-muted text-right mt-1">{tijdLabel(m.created_at)}</p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2.5">
                  <div className="w-7 h-7 shrink-0 rounded-full bg-session/15 border border-session/40 flex items-center justify-center font-mono text-xs font-bold text-session mt-1">
                    J
                  </div>
                  <div className="max-w-[85%] bg-panel border border-edge rounded-2xl rounded-bl-md px-4 py-2.5">
                    <div className="review-md text-sm">
                      <ReactMarkdown>{m.text}</ReactMarkdown>
                    </div>
                    <p className="text-[10px] text-muted mt-1">{tijdLabel(m.created_at)}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {(streaming || (busy && !streaming)) && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 shrink-0 rounded-full bg-session/15 border border-session/40 flex items-center justify-center font-mono text-xs font-bold text-session mt-1">
              J
            </div>
            <div className="max-w-[85%] bg-panel border border-edge rounded-2xl rounded-bl-md px-4 py-2.5">
              {streaming ? (
                <div className="review-md text-sm">
                  <ReactMarkdown>{streaming}</ReactMarkdown>
                </div>
              ) : (
                <span className="inline-flex gap-1 py-1.5" aria-label="Coach is aan het typen">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce [animation-delay:300ms]" />
                </span>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-short text-sm text-center">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="bg-panel border border-edge rounded-b-xl p-3 sticky bottom-4 shadow-lg shadow-ink/60">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            disabled={busy}
            rows={Math.min(5, Math.max(1, input.split("\n").length))}
            placeholder="Typ je vraag aan de coach…"
            className="flex-1 bg-ink border border-edge rounded-xl px-4 py-2.5 outline-none focus:border-session text-sm resize-none"
          />
          <button
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            className="bg-session text-ink font-semibold rounded-xl px-5 py-2.5 disabled:opacity-40 hover:brightness-110 transition"
          >
            Stuur
          </button>
        </div>
        <p className="text-[10px] text-muted mt-1.5 text-center">
          Coaching op proces en methode — geen live entries of financieel advies. Trade reviewen? Gebruik Review.
        </p>
      </div>
    </div>
  );
}
