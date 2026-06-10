"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { CHECK_KEYS, CHECK_LABELS } from "@/lib/journal";
import type { Trade } from "@/lib/types";

type Filter = "alle" | "winst" | "verlies" | "open";

export default function JournalPage() {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("alle");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [shots, setShots] = useState<Record<string, string[]>>({});

  useEffect(() => {
    createClient()
      .from("trades")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => setTrades((data as Trade[]) ?? []));
  }, []);

  const stats = useMemo(() => {
    if (!trades || trades.length === 0) return null;
    const closed = trades.filter((t) => t.uitkomst === "winst" || t.uitkomst === "verlies");
    const wins = closed.filter((t) => t.uitkomst === "winst").length;
    const withR = trades.filter((t) => t.resultaat_r != null && isFinite(Number(t.resultaat_r)));
    const rTotal = withR.reduce((s, t) => s + Number(t.resultaat_r), 0);
    const expectancy = withR.length ? rTotal / withR.length : null;
    const scores = trades.filter((t) => t.discipline_score != null);
    const avgScore = scores.length
      ? scores.reduce((s, t) => s + Number(t.discipline_score ?? 0), 0) / scores.length
      : null;
    // Fouten niet alleen tellen maar ook prijzen: totaal R van trades waarin de fout voorkwam
    const tagStats: Record<string, { n: number; r: number; heeftR: boolean }> = {};
    for (const t of trades)
      for (const tag of t.fout_tags ?? [])
        if (tag !== "Geen fout") {
          tagStats[tag] = tagStats[tag] ?? { n: 0, r: 0, heeftR: false };
          tagStats[tag].n++;
          if (t.resultaat_r != null && isFinite(Number(t.resultaat_r))) {
            tagStats[tag].r += Number(t.resultaat_r);
            tagStats[tag].heeftR = true;
          }
        }
    const topTags = Object.entries(tagStats)
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 5);
    // Discipline-streak: aantal recentste trades op rij met score >= 7
    let streak = 0;
    for (const t of trades) {
      if (t.discipline_score != null && Number(t.discipline_score) >= 7) streak++;
      else break;
    }
    const openCount = trades.filter(
      (t) => (t.uitkomst === "open" || t.uitkomst === "onbekend") && t.resultaat_r == null
    ).length;
    const spark = [...trades]
      .slice(0, 15)
      .reverse()
      .map((t) => (t.discipline_score != null ? Number(t.discipline_score) : null))
      .filter((s): s is number => s != null && isFinite(s));
    return {
      total: trades.length,
      winrate: closed.length ? Math.round((wins / closed.length) * 100) : null,
      closedCount: closed.length,
      rTotal,
      avgScore,
      expectancy,
      rCount: withR.length,
      topTags,
      maxTag: topTags[0]?.[1].n ?? 0,
      spark,
      streak,
      openCount,
    };
  }, [trades]);

  const visible = useMemo(() => {
    if (!trades) return [];
    return trades.filter((t) => {
      if (filter === "winst" && t.uitkomst !== "winst") return false;
      if (filter === "verlies" && t.uitkomst !== "verlies") return false;
      if (filter === "open" && !(t.uitkomst === "open" || t.uitkomst === "onbekend")) return false;
      if (tagFilter && !(t.fout_tags ?? []).includes(tagFilter)) return false;
      return true;
    });
  }, [trades, filter, tagFilter]);

  async function toggle(t: Trade) {
    const next = open === t.id ? null : t.id;
    setOpen(next);
    if (next && t.screenshots?.length && !shots[t.id]) {
      const { data } = await createClient()
        .storage.from("screenshots")
        .createSignedUrls(t.screenshots, 3600);
      if (data) setShots((s) => ({ ...s, [t.id]: data.map((d) => d.signedUrl).filter(Boolean) as string[] }));
    }
  }

  async function remove(id: string) {
    if (!confirm("Entry definitief verwijderen?")) return;
    await createClient().from("trades").delete().eq("id", id);
    setTrades((t) => (t ? t.filter((x) => x.id !== id) : t));
  }

  async function saveResult(id: string, uitkomst: string, r: number | null) {
    await createClient().from("trades").update({ uitkomst, resultaat_r: r }).eq("id", id);
    setTrades((ts) =>
      ts ? ts.map((t) => (t.id === id ? { ...t, uitkomst, resultaat_r: r } : t)) : ts
    );
  }

  return (
    <div>
      <p className="font-mono text-xs text-session tracking-[0.2em] uppercase mb-2">Journal</p>
      <h1 className="text-2xl font-bold tracking-tight mb-6">Jouw trades</h1>

      {trades === null && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-panel border border-edge rounded-xl h-20 animate-pulse" />
          ))}
        </div>
      )}

      {trades?.length === 0 && (
        <div className="bg-panel border border-edge rounded-xl p-10 text-center">
          <p className="font-mono text-session text-2xl mb-3">0 / 0</p>
          <p className="text-muted text-sm mb-5 max-w-xs mx-auto">
            Je journal is nog leeg. Na elke review schrijft de mentor hier automatisch een entry bij.
          </p>
          <Link href="/review" className="inline-block bg-session text-ink font-semibold rounded-lg px-5 py-2 text-sm">
            Eerste trade reviewen
          </Link>
        </div>
      )}

      {stats && trades && trades.length > 0 && (
        <>
          {/* Open trades: resultaat bijwerken is een dagelijkse actie, dus bovenaan */}
          {stats.openCount > 0 && filter !== "open" && (
            <button
              onClick={() => setFilter("open")}
              className="w-full mb-4 bg-session/10 border border-session/30 rounded-xl px-4 py-2.5 text-sm text-left hover:bg-session/15 transition-colors"
            >
              <span className="text-session font-medium">
                {stats.openCount} trade{stats.openCount > 1 ? "s" : ""} zonder resultaat
              </span>{" "}
              <span className="text-muted">— klik om bij te werken (uitkomst + R)</span>
            </button>
          )}

          {/* Statistieken */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
            <Stat label="Trades" value={String(stats.total)} />
            <Stat
              label="Winrate"
              value={stats.winrate != null ? `${stats.winrate}%` : "—"}
              sub={stats.winrate != null ? `${stats.closedCount} gesloten` : "nog geen resultaten"}
            />
            <Stat
              label="Totaal R"
              value={`${stats.rTotal > 0 ? "+" : ""}${Number(stats.rTotal.toFixed(2))}R`}
              tone={stats.rTotal > 0 ? "long" : stats.rTotal < 0 ? "short" : undefined}
            />
            {/* Expectancy onder n=20 is ruis — dan liever de discipline-streak tonen */}
            {stats.rCount >= 20 && stats.expectancy != null ? (
              <Stat
                label="Expectancy"
                value={`${stats.expectancy > 0 ? "+" : ""}${stats.expectancy.toFixed(2)}R`}
                sub={`per trade, n=${stats.rCount}`}
                tone={stats.expectancy > 0 ? "long" : "short"}
              />
            ) : (
              <Stat
                label="Streak ≥7"
                value={stats.streak > 0 ? `${stats.streak} 🔥` : "0"}
                sub="trades op rij gedisciplineerd"
                tone={stats.streak >= 3 ? "long" : undefined}
              />
            )}
            <Stat
              label="Gem. discipline"
              value={stats.avgScore != null ? `${stats.avgScore.toFixed(1)}/10` : "—"}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
            {/* Discipline-trend */}
            {stats.spark.length >= 2 && (
              <div className="bg-panel border border-edge rounded-xl p-4">
                <p className="text-xs text-muted uppercase tracking-wider mb-2">Discipline-trend</p>
                <Sparkline values={stats.spark} />
              </div>
            )}
            {/* Meest voorkomende fouten */}
            {stats.topTags.length > 0 && (
              <div className="bg-panel border border-edge rounded-xl p-4">
                <p className="text-xs text-muted uppercase tracking-wider mb-2">Meest gemaakte fouten</p>
                <div className="space-y-1.5">
                  {stats.topTags.map(([tag, s]) => (
                    <button
                      key={tag}
                      onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                      className="w-full text-left group"
                      title={`Filter op ${tag}`}
                    >
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className={tagFilter === tag ? "text-session" : "group-hover:text-paper"}>{tag}</span>
                        <span className="font-mono text-muted">
                          {s.n}×
                          {s.heeftR && (
                            <span className={s.r < 0 ? "text-short" : "text-long"}>
                              {" "}· {s.r > 0 ? "+" : ""}{Number(s.r.toFixed(1))}R
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-1.5 bg-ink rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${tagFilter === tag ? "bg-session" : "bg-short/70"}`}
                          style={{ width: `${(s.n / stats.maxTag) * 100}%` }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            {(["alle", "winst", "verlies", "open"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  filter === f
                    ? "border-session text-session bg-session/10"
                    : "border-edge text-muted hover:text-paper"
                }`}
              >
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
            {tagFilter && (
              <button
                onClick={() => setTagFilter(null)}
                className="px-3 py-1 rounded-full text-xs border border-session text-session bg-session/10"
              >
                {tagFilter} ✕
              </button>
            )}
            <span className="ml-auto font-mono text-xs text-muted">{visible.length} getoond</span>
          </div>
        </>
      )}

      {/* Entries */}
      <div className="space-y-3">
        {visible.map((t) => (
          <div key={t.id} className="bg-panel border border-edge rounded-xl overflow-hidden">
            <button onClick={() => toggle(t)} className="w-full text-left p-4 hover:bg-edge/30 transition-colors">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm text-session">{t.trade_date}</span>
                <RichtingBadge richting={t.richting} />
                {t.discipline_score != null && <ScoreBadge score={t.discipline_score} />}
                <ResultBadge uitkomst={t.uitkomst} r={t.resultaat_r} />
              </div>
              <p className="text-sm mt-2 line-clamp-2">{t.setup || t.entry_reden}</p>
              {(t.fout_tags ?? []).filter((x) => x !== "Geen fout").length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {(t.fout_tags ?? [])
                    .filter((x) => x !== "Geen fout")
                    .map((tag) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-short/10 text-short border border-short/20">
                        {tag}
                      </span>
                    ))}
                </div>
              )}
            </button>

            {open === t.id && (
              <div className="border-t border-edge p-4">
                {shots[t.id]?.length ? (
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {shots[t.id].map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt={`Chart ${i + 1}`} className="rounded-lg border border-edge hover:border-session/60 transition-colors" />
                      </a>
                    ))}
                  </div>
                ) : null}

                {t.checks && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {CHECK_KEYS.map((k) => {
                      const v = t.checks?.[k];
                      if (v == null) return null;
                      return (
                        <span
                          key={k}
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                            v
                              ? "bg-long/10 text-long border-long/25"
                              : "bg-short/10 text-short border-short/25"
                          }`}
                        >
                          {v ? "✓" : "✗"} {CHECK_LABELS[k]}
                        </span>
                      );
                    })}
                  </div>
                )}

                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm mb-4">
                  <Row k="Entry-tijd (NY)" v={t.entry_tijd} mono />
                  <Row k="R:R gepland" v={t.rr_gepland} mono />
                  <Row k="Setup" v={t.setup} />
                  <Row k="Entry reden" v={t.entry_reden} />
                  <Row k="Fout(en)" v={t.fouten} accent="short" />
                  <Row k="Les" v={t.les} accent="long" />
                  <Row k="Actiepunt" v={t.actiepunt} />
                </dl>

                <ResultEditor trade={t} onSave={saveResult} />

                <details className="mt-4">
                  <summary className="text-xs text-muted cursor-pointer hover:text-paper">
                    Volledige review tonen
                  </summary>
                  <div className="review-md text-sm mt-3">
                    <ReactMarkdown>{t.review_md}</ReactMarkdown>
                  </div>
                </details>

                {Array.isArray(t.gesprek) && t.gesprek.length > 2 && (
                  <details className="mt-2">
                    <summary className="text-xs text-muted cursor-pointer hover:text-paper">
                      Gesprek met de mentor tonen ({t.gesprek.length} berichten)
                    </summary>
                    <div className="mt-3 space-y-2">
                      {t.gesprek.map((m, i) => (
                        <div
                          key={i}
                          className={`text-sm rounded-lg px-3 py-2 border ${
                            m.role === "user"
                              ? "bg-edge/40 border-edge ml-6"
                              : "bg-ink/60 border-edge mr-6"
                          }`}
                        >
                          <p className="text-[10px] text-muted uppercase tracking-wider mb-0.5">
                            {m.role === "user" ? "Jij" : "Mentor"}
                          </p>
                          <p className="whitespace-pre-wrap">{m.text}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <button onClick={() => remove(t.id)} className="mt-4 text-xs text-short/80 hover:text-short hover:underline">
                  Entry verwijderen
                </button>
              </div>
            )}
          </div>
        ))}
        {trades && trades.length > 0 && visible.length === 0 && (
          <p className="text-muted text-sm text-center py-8">Geen trades binnen dit filter.</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "long" | "short" }) {
  return (
    <div className="bg-panel border border-edge rounded-xl p-3.5">
      <p className="text-[10px] text-muted uppercase tracking-wider">{label}</p>
      <p className={`font-mono text-xl font-bold mt-0.5 ${tone === "long" ? "text-long" : tone === "short" ? "text-short" : ""}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 240;
  const h = 56;
  const pad = 4;
  const step = (w - pad * 2) / Math.max(1, values.length - 1);
  const y = (v: number) => h - pad - ((v - 1) / 9) * (h - pad * 2);
  const points = values.map((v, i) => `${pad + i * step},${y(v)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <div className="flex items-center gap-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" preserveAspectRatio="none" aria-label="Discipline-scores over tijd">
        <line x1={pad} x2={w - pad} y1={y(5.5)} y2={y(5.5)} stroke="#1F2937" strokeDasharray="3 3" />
        <polyline points={points} fill="none" stroke="#E8A33D" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {values.map((v, i) => (
          <circle key={i} cx={pad + i * step} cy={y(v)} r="2.4" fill="#0C1017" stroke="#E8A33D" strokeWidth="1.5" />
        ))}
      </svg>
      <span className="font-mono text-lg font-bold text-session shrink-0">{last}/10</span>
    </div>
  );
}

function RichtingBadge({ richting }: { richting: string }) {
  if (richting === "long")
    return <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-long/10 text-long border border-long/25">LONG</span>;
  if (richting === "short")
    return <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-short/10 text-short border border-short/25">SHORT</span>;
  return null;
}

function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 7 ? "text-long border-long/25 bg-long/10" : score >= 5 ? "text-session border-session/25 bg-session/10" : "text-short border-short/25 bg-short/10";
  return <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${tone}`}>{score}/10</span>;
}

function ResultBadge({ uitkomst, r }: { uitkomst: string; r: number | null }) {
  if (uitkomst === "winst")
    return <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-long/10 text-long border border-long/25">{r != null ? `+${Number(r)}R` : "WINST"}</span>;
  if (uitkomst === "verlies")
    return <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-short/10 text-short border border-short/25">{r != null ? `${Number(r)}R` : "VERLIES"}</span>;
  if (uitkomst === "breakeven")
    return <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-edge text-muted border border-edge">BE</span>;
  return <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-edge/60 text-muted border border-edge">OPEN</span>;
}

function ResultEditor({
  trade,
  onSave,
}: {
  trade: Trade;
  onSave: (id: string, uitkomst: string, r: number | null) => void;
}) {
  const [uitkomst, setUitkomst] = useState(trade.uitkomst || "onbekend");
  const [r, setR] = useState(trade.resultaat_r != null ? String(trade.resultaat_r) : "");
  const dirty = uitkomst !== trade.uitkomst || (r === "" ? null : Number(r)) !== trade.resultaat_r;

  return (
    <div className="flex flex-wrap items-end gap-2 bg-ink/60 border border-edge rounded-lg p-3">
      <div>
        <label className="block text-[10px] text-muted uppercase tracking-wider mb-1">Uitkomst</label>
        <select
          value={uitkomst}
          onChange={(e) => setUitkomst(e.target.value)}
          className="bg-ink border border-edge rounded-md px-2 py-1.5 text-sm outline-none focus:border-session"
        >
          <option value="onbekend">Onbekend</option>
          <option value="open">Open</option>
          <option value="winst">Winst</option>
          <option value="verlies">Verlies</option>
          <option value="breakeven">Breakeven</option>
        </select>
      </div>
      <div>
        <label className="block text-[10px] text-muted uppercase tracking-wider mb-1">Resultaat (R)</label>
        <input
          value={r}
          onChange={(e) => setR(e.target.value.replace(",", "."))}
          placeholder="bijv. 2.5 of -1"
          className="w-28 bg-ink border border-edge rounded-md px-2 py-1.5 text-sm font-mono outline-none focus:border-session"
        />
      </div>
      <button
        onClick={() => onSave(trade.id, uitkomst, r === "" || isNaN(Number(r)) ? null : Number(r))}
        disabled={!dirty}
        className="bg-session text-ink text-sm font-semibold rounded-md px-3.5 py-1.5 disabled:opacity-30 hover:brightness-110 transition"
      >
        Resultaat opslaan
      </button>
    </div>
  );
}

function Row({ k, v, accent, mono }: { k: string; v: string; accent?: "long" | "short"; mono?: boolean }) {
  if (!v) return null;
  return (
    <div>
      <dt className="text-[10px] text-muted uppercase tracking-wider">{k}</dt>
      <dd className={`${accent === "short" ? "text-short" : accent === "long" ? "text-long" : ""} ${mono ? "font-mono" : ""}`}>
        {v}
      </dd>
    </div>
  );
}
