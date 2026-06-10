import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCoachSystemPrompt } from "@/lib/kennisbank";
import type { ChatMessage } from "@/lib/types";

export const maxDuration = 300;

const MAX_MESSAGES = 30;
const MAX_TEXT_CHARS = 8_000;
const RATE_LIMIT_PER_HOUR = 30;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  const uid = user.id;

  // ---- Invoer valideren ----
  const body = await req.json().catch(() => null);
  const incoming: ChatMessage[] = Array.isArray(body?.messages) ? body.messages.slice(-MAX_MESSAGES) : [];

  if (incoming.length === 0 || incoming[incoming.length - 1].role !== "user") {
    return Response.json({ error: "Geen vraag ontvangen." }, { status: 400 });
  }
  for (const m of incoming) {
    if (m.role !== "user" && m.role !== "assistant") {
      return Response.json({ error: "Ongeldig bericht." }, { status: 400 });
    }
    if (typeof m.text !== "string" || !m.text.trim()) {
      return Response.json({ error: "Leeg bericht." }, { status: 400 });
    }
    if (m.text.length > MAX_TEXT_CHARS) {
      m.text = m.text.slice(0, MAX_TEXT_CHARS);
    }
  }

  // ---- Rate limit (gedeeld met de review, per gebruiker, voortschrijdend uur) ----
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase
    .from("api_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid)
    .gte("created_at", hourAgo);
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return Response.json(
      { error: `Limiet bereikt (${RATE_LIMIT_PER_HOUR} berichten per uur). Probeer het later opnieuw.` },
      { status: 429 }
    );
  }
  await supabase.from("api_calls").insert({ user_id: uid });

  // ---- Coach-geheugen: samenvatting van het journal van deze student ----
  // Apart (ongecachet) system-blok ná het gecachete kennisbank-blok, zodat de cache intact blijft.
  const { data: recent } = await supabase
    .from("trades")
    .select("trade_date, entry_tijd, richting, setup, fout_tags, discipline_score, uitkomst, resultaat_r")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(20);

  let studentContext = "# JOURNAL VAN DEZE STUDENT\nNog geen trades in het journal. Moedig de student aan zijn eerste trade te laten reviewen.";
  if (recent && recent.length > 0) {
    const closed = recent.filter((t) => t.uitkomst === "winst" || t.uitkomst === "verlies");
    const wins = closed.filter((t) => t.uitkomst === "winst").length;
    const withR = recent.filter((t) => t.resultaat_r != null);
    const rTotal = withR.reduce((s, t) => s + Number(t.resultaat_r), 0);
    const scores = recent.filter((t) => t.discipline_score != null);
    const avgScore = scores.length
      ? (scores.reduce((s, t) => s + Number(t.discipline_score), 0) / scores.length).toFixed(1)
      : "—";
    const tagStats: Record<string, { n: number; r: number }> = {};
    for (const t of recent)
      for (const tag of t.fout_tags ?? [])
        if (tag !== "Geen fout") {
          tagStats[tag] = tagStats[tag] ?? { n: 0, r: 0 };
          tagStats[tag].n++;
          if (t.resultaat_r != null) tagStats[tag].r += Number(t.resultaat_r);
        }
    const tagLines = Object.entries(tagStats)
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 6)
      .map(([tag, s]) => `- ${tag}: ${s.n}× (totaal ${s.r >= 0 ? "+" : ""}${s.r.toFixed(1)}R op die trades)`)
      .join("\n");
    const tradeLines = recent
      .slice(0, 10)
      .map(
        (t) =>
          `- ${t.trade_date}${t.entry_tijd ? ` ${t.entry_tijd}` : ""} ${t.richting}, score ${t.discipline_score ?? "?"}/10, ${t.uitkomst}${t.resultaat_r != null ? ` (${Number(t.resultaat_r) >= 0 ? "+" : ""}${t.resultaat_r}R)` : ""}${(t.fout_tags ?? []).filter((x: string) => x !== "Geen fout").length ? `, fouten: ${(t.fout_tags ?? []).filter((x: string) => x !== "Geen fout").join(", ")}` : ""}${t.setup ? ` — ${String(t.setup).slice(0, 80)}` : ""}`
      )
      .join("\n");
    studentContext = `# JOURNAL VAN DEZE STUDENT (laatste ${recent.length} trades — gebruik dit actief in je coaching)
Samenvatting: winrate ${closed.length ? Math.round((wins / closed.length) * 100) + "%" : "n.v.t."} over ${closed.length} gesloten trades, totaal ${rTotal >= 0 ? "+" : ""}${rTotal.toFixed(1)}R (n=${withR.length}), gemiddelde discipline ${avgScore}/10.
Meest gemaakte fouten:
${tagLines || "- geen fout-tags geregistreerd"}
Recente trades:
${tradeLines}

Verwijs concreet naar deze patronen wanneer relevant ("je laatste drie shorts misten een trigger"), maar plak ze er niet geforceerd bij elk antwoord in.`;
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 2000,
      stream: true,
      // cache_control op het statische blok; het journal-blok varieert per student en blijft erbuiten
      system: [
        { type: "text", text: buildCoachSystemPrompt(), cache_control: { type: "ephemeral" } },
        { type: "text", text: studentContext },
      ],
      messages: incoming.map((m) => ({ role: m.role, content: m.text.trim() })),
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const status = upstream.status;
    const err = await upstream.text().catch(() => "");
    console.error("Anthropic API error (coach):", status, err);
    const msg =
      status === 429 || status === 529
        ? "De coach heeft het even te druk. Probeer het over een halve minuut opnieuw."
        : "De coach is even niet bereikbaar. Probeer het opnieuw.";
    return Response.json({ error: msg }, { status: 502 });
  }

  // ---- Streamen + server-side opslag van de gespreksgeschiedenis ----
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = "";
  let fullText = "";

  const lastUserText = incoming[incoming.length - 1].text.trim();

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        // Beide berichten pas opslaan als het antwoord compleet is — tab dicht na dit punt kan geen kwaad
        if (fullText.trim()) {
          const { error: insErr } = await supabase.from("coach_messages").insert([
            { user_id: uid, role: "user", content: lastUserText },
            { user_id: uid, role: "assistant", content: fullText.trim() },
          ]);
          if (insErr) console.error("Coach chat opslaan mislukt:", insErr);
        }
        controller.close();
        return;
      }
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload);
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            fullText += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          } else if (event.type === "error") {
            console.error("Anthropic stream error (coach):", event.error);
          }
        } catch {
          // onvolledige JSON-regel — wordt in volgende chunk afgemaakt
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
