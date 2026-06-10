import { createClient } from "@/lib/supabase/server";
import { buildCoachSystemPrompt } from "@/lib/kennisbank";

export const maxDuration = 120;

const RATE_LIMIT_PER_HOUR = 30;

// Genereert een AI-debrief over de recente trades: patronen, R-kosten per fout, één focuspunt.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const uid = user.id;

  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase
    .from("api_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid)
    .gte("created_at", hourAgo);
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return Response.json({ error: "Limiet bereikt. Probeer het later opnieuw." }, { status: 429 });
  }
  await supabase.from("api_calls").insert({ user_id: uid });

  const { data: trades } = await supabase
    .from("trades")
    .select("trade_date, entry_tijd, richting, setup, fouten, fout_tags, discipline_score, checks, uitkomst, resultaat_r, les")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(40);

  if (!trades || trades.length < 3) {
    return Response.json(
      { error: "Nog te weinig trades voor een debrief — review er eerst minstens drie." },
      { status: 400 }
    );
  }

  const dataBlock = trades
    .map(
      (t) =>
        `${t.trade_date}${t.entry_tijd ? ` ${t.entry_tijd}` : ""} | ${t.richting} | score ${t.discipline_score ?? "?"}/10 | ${t.uitkomst}${t.resultaat_r != null ? ` ${Number(t.resultaat_r) >= 0 ? "+" : ""}${t.resultaat_r}R` : ""} | fouten: ${(t.fout_tags ?? []).join(", ") || "—"} | checks: ${t.checks ? JSON.stringify(t.checks) : "—"} | ${String(t.setup || "").slice(0, 60)}`
    )
    .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 1500,
      system: [
        { type: "text", text: buildCoachSystemPrompt(), cache_control: { type: "ephemeral" } },
        {
          type: "text",
          text: `Schrijf een DEBRIEF over de onderstaande trades van deze student (recentste eerst). Geen vragen stellen, geen gesprek — één compacte analyse in Markdown met exact deze secties:

## Debrief (${trades.length} trades)
### Patronen
2–4 concrete patronen die je in de data ziet (koppel fout-tags, checks, tijden en R aan elkaar; benoem ook wat goed gaat).
### Wat je fouten kosten
De 2–3 duurste fouten in R, met de getallen erbij.
### Focus voor komende week
Eén (1) focuspunt, concreet en toetsbaar geformuleerd, afgeleid van het duurste of meest frequente patroon.

Wees direct en specifiek; verwijs naar data ("3 van je 4 verliezen misten een entry trigger"), niet naar algemeenheden. Geen richting of marktvoorspelling.`,
        },
      ],
      messages: [{ role: "user", content: `Mijn trades:\n${dataBlock}` }],
    }),
  });

  if (!res.ok) {
    console.error("Anthropic API error (debrief):", res.status, await res.text().catch(() => ""));
    return Response.json({ error: "De debrief kon niet worden gegenereerd. Probeer het opnieuw." }, { status: 502 });
  }
  const json = await res.json();
  const md = Array.isArray(json.content)
    ? json.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
    : "";
  return Response.json({ debrief: md });
}
