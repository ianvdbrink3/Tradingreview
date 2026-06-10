"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import Link from "next/link";
import SessionClock from "../components/session-clock";
import { extractJournal } from "@/lib/journal";
import type { ChatImage, ChatMessage } from "@/lib/types";

type Img = ChatImage & { preview: string };
type ThreadMsg = ChatMessage & { previews?: string[] };
type Meta = { trade_id?: string; updated?: boolean; save_error?: boolean; stream_error?: boolean };

const MAX_DIM = 1568;
const MAX_IMAGES = 4;
const META_SEP = "\u001E";

async function compressImage(file: File): Promise<Img> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("Bestand lezen mislukt"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Afbeelding laden mislukt"));
    i.src = dataUrl;
  });
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpeg = canvas.toDataURL("image/jpeg", 0.85);
  return { media_type: "image/jpeg", data: jpeg.split(",")[1], preview: jpeg };
}

export default function ReviewPage() {
  // Composer (eerste bericht)
  const [images, setImages] = useState<Img[]>([]);
  const [timeframe, setTimeframe] = useState("");
  const [bias, setBias] = useState("");
  const [levels, setLevels] = useState("");
  const [reden, setReden] = useState("");
  const [notities, setNotities] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // Gesprek
  const [thread, setThread] = useState<ThreadMsg[]>([]);
  const [streaming, setStreaming] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [followUpImages, setFollowUpImages] = useState<Img[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTradeId, setSavedTradeId] = useState<string | null>(null);
  const [resultUpdated, setResultUpdated] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const followUpFileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const started = thread.length > 0;

  // Plakken vanaf klembord (TradingView-screenshot -> Ctrl/Cmd+V)
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (busy) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      if (started) addFollowUpFiles(files);
      else addFiles(files);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, started, images.length]);

  // Waarschuwing bij sluiten tijdens een lopend antwoord
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy]);

  // Stream afbreken bij wegnavigeren
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [streaming, thread.length]);

  async function addFiles(files: File[]) {
    setError(null);
    try {
      const next = await Promise.all(files.slice(0, MAX_IMAGES).map(compressImage));
      setImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
    } catch {
      setError("Een van de afbeeldingen kon niet worden verwerkt.");
    }
  }

  async function addFollowUpFiles(files: File[]) {
    setError(null);
    try {
      const next = await Promise.all(files.slice(0, MAX_IMAGES).map(compressImage));
      setFollowUpImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
    } catch {
      setError("Een van de afbeeldingen kon niet worden verwerkt.");
    }
  }

  async function send(userMsg: ThreadMsg, restoreOnError?: () => void) {
    setBusy(true);
    setError(null);
    setResultUpdated(false);
    const nextThread = [...thread, userMsg];
    setThread(nextThread);
    setStreaming("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          saved_trade_id: savedTradeId,
          messages: nextThread.map(({ role, text, images }) => ({ role, text, images })),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "De mentor reageert niet. Probeer het opnieuw.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      let metaRaw = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (metaRaw || chunk.includes(META_SEP)) {
          const sepIdx = chunk.indexOf(META_SEP);
          if (!metaRaw && sepIdx >= 0) {
            full += chunk.slice(0, sepIdx);
            metaRaw = chunk.slice(sepIdx + 1);
          } else {
            metaRaw += chunk;
          }
        } else {
          full += chunk;
        }
        setStreaming(extractJournal(full).clean);
      }

      const { clean } = extractJournal(full);
      setStreaming("");
      setThread((t) => [...t, { role: "assistant", text: clean }]);

      let meta: Meta = {};
      try {
        meta = JSON.parse(metaRaw || "{}");
      } catch {}
      if (meta.trade_id) setSavedTradeId(meta.trade_id);
      if (meta.updated) setResultUpdated(true);
      if (meta.save_error) setSaveError(true);
      if (meta.stream_error)
        setError("De verbinding viel halverwege weg — het antwoord kan onvolledig zijn. Stuur eventueel een vervolgbericht.");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setThread((t) => t.slice(0, -1)); // user-bericht terugdraaien zodat opnieuw versturen kan
      restoreOnError?.();
      setError(e.message || "Er ging iets mis.");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function startReview() {
    const context = [
      timeframe && `Timeframe: ${timeframe}`,
      bias && `HTF-bias: ${bias}`,
      levels && `Entry / SL / TP: ${levels}`,
      reden && `Reden voor entry: ${reden}`,
      notities && `Notities: ${notities}`,
    ]
      .filter(Boolean)
      .join("\n");

    send({
      role: "user",
      text: `Review deze trade volgens de methode.\n\nContext van de trader:\n${context || "(geen extra context gegeven)"}`,
      images: images.map(({ media_type, data }) => ({ media_type, data })),
      previews: images.map((i) => i.preview),
    });
  }

  function sendFollowUp() {
    if (busy) return;
    if (!followUp.trim() && followUpImages.length === 0) return;
    const msg = followUp.trim() || "(zie screenshot)";
    const imgs = followUpImages;
    setFollowUp("");
    setFollowUpImages([]);
    send(
      {
        role: "user",
        text: msg,
        images: imgs.map(({ media_type, data }) => ({ media_type, data })),
        previews: imgs.map((i) => i.preview),
      },
      () => {
        setFollowUp(followUp.trim());
        setFollowUpImages(imgs);
      }
    );
  }

  function reset() {
    abortRef.current?.abort();
    setThread([]);
    setStreaming("");
    setImages([]);
    setTimeframe("");
    setBias("");
    setLevels("");
    setReden("");
    setNotities("");
    setFollowUp("");
    setFollowUpImages([]);
    setSavedTradeId(null);
    setResultUpdated(false);
    setSaveError(false);
    setError(null);
    setBusy(false);
  }

  const canStart = !busy && (images.length > 0 || notities.trim() || reden.trim());

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <p className="font-mono text-xs text-session tracking-[0.2em] uppercase mb-2">
            {started ? "Review-gesprek" : "Nieuwe review"}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">
            {started ? "De mentor kijkt mee" : "Upload je trade"}
          </h1>
        </div>
        {started && (
          <button onClick={reset} className="text-sm text-muted hover:text-paper underline underline-offset-4">
            Nieuwe trade
          </button>
        )}
      </div>

      {!started && (
        <>
          <div className="sm:hidden mb-4">
            <SessionClock />
          </div>
          <div className="bg-panel border border-edge rounded-xl p-5">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/")));
              }}
              className={`w-full border border-dashed rounded-lg py-7 text-sm transition-colors ${
                dragOver
                  ? "border-session text-paper bg-session/5"
                  : "border-edge text-muted hover:border-session/60 hover:text-paper"
              }`}
            >
              {images.length === 0 ? (
                <>
                  <span className="block font-medium text-paper mb-1">Chart-screenshots toevoegen</span>
                  <span className="block">klik, sleep hierheen, of plak met Ctrl+V · max {MAX_IMAGES}</span>
                </>
              ) : (
                `Nog een screenshot toevoegen (${images.length}/${MAX_IMAGES})`
              )}
            </button>

            {images.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                {images.map((img, i) => (
                  <div key={i} className="relative group">
                    <img src={img.preview} alt={`Screenshot ${i + 1}`} className="rounded-lg border border-edge" />
                    <button
                      onClick={() => setImages(images.filter((_, j) => j !== i))}
                      className="absolute top-1.5 right-1.5 bg-ink/85 text-paper rounded-md px-2 py-0.5 text-xs opacity-80 hover:opacity-100"
                    >
                      Verwijder
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
              <Field label="Timeframe" value={timeframe} onChange={setTimeframe} placeholder="bijv. 1m entry, 15m context" />
              <Field label="HTF-bias" value={bias} onChange={setBias} placeholder="bijv. bearish na sweep PDH" />
            </div>
            <Field label="Entry / SL / TP" value={levels} onChange={setLevels} placeholder="bijv. 21540 / 21565 / 21480" mono className="mt-3" />
            <Field label="Reden voor entry" value={reden} onChange={setReden} placeholder="bijv. MSS + FVG na liquidity sweep" className="mt-3" />
            <div className="mt-3">
              <label className="block text-xs text-muted mb-1">Notities</label>
              <textarea
                value={notities}
                onChange={(e) => setNotities(e.target.value)}
                rows={3}
                className="w-full bg-ink border border-edge rounded-lg px-3 py-2 outline-none focus:border-session text-sm"
                placeholder="Wat dacht en voelde je voor, tijdens en na de trade? Heb je het resultaat al (bijv. +2R)?"
              />
            </div>

            {error && <p className="text-short text-sm mt-3">{error}</p>}

            <button
              onClick={startReview}
              disabled={!canStart}
              className="w-full mt-4 bg-session text-ink font-semibold rounded-lg py-2.5 disabled:opacity-40 hover:brightness-110 transition"
            >
              Start review
            </button>
            <p className="text-[11px] text-muted mt-2 text-center">
              Ontbreekt er context? Dan stelt de mentor eerst vragen — je kunt gewoon terugschrijven.
            </p>
          </div>
        </>
      )}

      {started && (
        <div className="space-y-4">
          {thread.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="ml-6 sm:ml-16">
                <div className="bg-edge/40 border border-edge rounded-xl rounded-tr-sm px-4 py-3">
                  {m.previews && m.previews.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {m.previews.map((p, j) => (
                        <img key={j} src={p} alt="" className="rounded-md border border-edge" />
                      ))}
                    </div>
                  )}
                  <p className="text-sm whitespace-pre-wrap">
                    {m.text.replace(/^Review deze trade volgens de methode\.\n\nContext van de trader:\n/, "")}
                  </p>
                </div>
              </div>
            ) : (
              <div key={i} className="bg-panel border border-edge rounded-xl rounded-tl-sm p-5">
                <div className="review-md text-sm">
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                </div>
              </div>
            )
          )}

          {(streaming || (busy && !streaming)) && (
            <div className="bg-panel border border-edge rounded-xl rounded-tl-sm p-5">
              {streaming ? (
                <div className="review-md text-sm">
                  <ReactMarkdown>{streaming}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-muted animate-pulse">Mentor analyseert de chart…</p>
              )}
            </div>
          )}

          {savedTradeId && !busy && (
            <p className="text-long text-sm px-1">
              {resultUpdated ? "Resultaat bijgewerkt in je journal" : "Journal-entry opgeslagen"} ·{" "}
              <Link href="/journal" className="underline underline-offset-4">
                Bekijk journal
              </Link>
            </p>
          )}
          {saveError && !busy && (
            <p className="text-short text-sm px-1">
              De review is gelukt, maar opslaan in het journal is mislukt. Kopieer de review voor de zekerheid en
              probeer het later opnieuw.
            </p>
          )}

          {error && (
            <div className="px-1">
              <p className="text-short text-sm">{error}</p>
            </div>
          )}

          <div className="sticky bottom-4">
            {followUpImages.length > 0 && (
              <div className="flex gap-2 mb-2">
                {followUpImages.map((img, i) => (
                  <div key={i} className="relative">
                    <img src={img.preview} alt="" className="h-16 rounded-md border border-edge" />
                    <button
                      onClick={() => setFollowUpImages(followUpImages.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 bg-ink border border-edge text-paper rounded-full w-5 h-5 text-[10px] leading-none"
                      aria-label="Screenshot verwijderen"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end">
            <input
              ref={followUpFileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                addFollowUpFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <button
              onClick={() => followUpFileRef.current?.click()}
              disabled={busy}
              title="Screenshot toevoegen (of plak met Ctrl+V)"
              aria-label="Screenshot toevoegen"
              className="shrink-0 bg-panel border border-edge rounded-xl px-3.5 py-3 text-muted hover:text-paper hover:border-session/60 transition disabled:opacity-40 font-mono text-sm"
            >
              +
            </button>
            <textarea
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendFollowUp();
                }
              }}
              disabled={busy}
              rows={Math.min(5, Math.max(1, followUp.split("\n").length))}
              placeholder={savedTradeId ? "Vraag door, of deel je resultaat (bijv. +2R)…" : "Beantwoord de vragen van de mentor…"}
              className="flex-1 bg-panel border border-edge rounded-xl px-4 py-3 outline-none focus:border-session text-sm shadow-lg shadow-ink/60 resize-none"
            />
            <button
              onClick={sendFollowUp}
              disabled={busy || (!followUp.trim() && followUpImages.length === 0)}
              className="bg-session text-ink font-semibold rounded-xl px-5 py-3 disabled:opacity-40 hover:brightness-110 transition"
            >
              Stuur
            </button>
            </div>
          </div>
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-muted mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-ink border border-edge rounded-lg px-3 py-2 outline-none focus:border-session text-sm ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
