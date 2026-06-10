import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/kennisbank";
import { extractJournal, validateJournal, validateR, validateUitkomst } from "@/lib/journal";
import type { ChatMessage } from "@/lib/types";

export const maxDuration = 300;

const MAX_MESSAGES = 24;
const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_IMAGE_B64_CHARS = 5_000_000; // ~3,7 MB per afbeelding
const MAX_TEXT_CHARS = 8_000;
const RATE_LIMIT_PER_HOUR = 30;
const ALLOWED_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Het einde van de stream bevat één meta-regel, gescheiden door het record separator-teken.
const META_SEP = "\u001E";

function base64ToBytes(b64: string): Uint8Array {
  const bin = Buffer.from(b64, "base64");
  return new Uint8Array(bin);
}

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
  const savedTradeId: string | null =
    typeof body?.saved_trade_id === "string" && /^[0-9a-f-]{36}$/.test(body.saved_trade_id)
      ? body.saved_trade_id
      : null;

  if (incoming.length === 0) {
    return Response.json({ error: "Geen berichten ontvangen." }, { status: 400 });
  }
  for (const m of incoming) {
    if (m.role !== "user" && m.role !== "assistant") {
      return Response.json({ error: "Ongeldig bericht." }, { status: 400 });
    }
    if (typeof m.text === "string" && m.text.length > MAX_TEXT_CHARS) {
      m.text = m.text.slice(0, MAX_TEXT_CHARS);
    }
    if (Array.isArray(m.images)) {
      m.images = m.images.slice(0, MAX_IMAGES_PER_MESSAGE);
      for (const img of m.images) {
        if (
          !ALLOWED_MEDIA.includes(img.media_type) ||
          typeof img.data !== "string" ||
          img.data.length > MAX_IMAGE_B64_CHARS
        ) {
          return Response.json(
            { error: "Een afbeelding is te groot of heeft een niet-ondersteund formaat." },
            { status: 400 }
          );
        }
      }
    }
  }
  const hasContent = incoming.some((m) => (m.text && m.text.trim()) || (m.images && m.images.length > 0));
  if (!hasContent) {
    return Response.json({ error: "Upload minstens één screenshot of vul context in." }, { status: 400 });
  }

  // ---- Rate limit (per gebruiker, voortschrijdend uur) ----
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
  await supabase.from("api_calls").insert({ user_id: user.id });

  // ---- Berichten opbouwen voor de Anthropic API ----
  const today = new Date().toISOString().slice(0, 10);
  const messages = incoming.map((m, idx) => {
    const content: any[] = [];
    if (m.role === "user" && Array.isArray(m.images)) {
      for (const img of m.images) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: img.media_type, data: img.data },
        });
      }
    }
    const prefix = idx === 0 && m.role === "user" ? `Datum van vandaag: ${today}\n\n` : "";
    content.push({ type: "text", text: prefix + (m.text?.trim() || "(geen tekst)") });
    return { role: m.role, content };
  });

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 4000,
      stream: true,
      // cache_control: system prompt (incl. kennisbank) wordt gecachet — scheelt fors in kosten
      system: [{ type: "text", text: buildSystemPrompt(), cache_control: { type: "ephemeral" } }],
      messages,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const status = upstream.status;
    const err = await upstream.text().catch(() => "");
    console.error("Anthropic API error:", status, err);
    const msg =
      status === 429 || status === 529
        ? "De mentor heeft het even te druk. Probeer het over een halve minuut opnieuw."
        : "De mentor is even niet bereikbaar. Probeer het opnieuw.";
    return Response.json({ error: msg }, { status: 502 });
  }

  // ---- Streamen + server-side opslag ----
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = "";
  let fullText = "";
  let upstreamErrored = false;

  const firstMsg = incoming[0];
  const textOnlyConversation = () =>
    incoming
      .map((m) => ({ role: m.role, text: (m.text || "").trim() }))
      .concat([{ role: "assistant" as const, text: extractJournal(fullText).clean }]);

  async function persist(): Promise<{ trade_id?: string; updated?: boolean; save_error?: boolean }> {
    const { clean, journal, update } = extractJournal(fullText);
    const meta: { trade_id?: string; updated?: boolean; save_error?: boolean } = {};

    try {
      if (journal && !savedTradeId) {
        const j = validateJournal(journal);
        const { data: row, error: insErr } = await supabase
          .from("trades")
          .insert({
            user_id: uid,
            trade_date: j.datum,
            markt: j.markt,
            sessie: j.sessie,
            richting: j.richting,
            setup: j.setup,
            entry_reden: j.entry_reden,
            fouten: j.fouten,
            fout_tags: j.fout_tags,
            les: j.les,
            actiepunt: j.actiepunt,
            discipline_score: j.discipline_score,
            rr_gepland: j.rr_gepland,
            uitkomst: j.uitkomst,
            resultaat_r: j.resultaat_r,
            review_md: clean,
            context: firstMsg?.text || "",
            gesprek: textOnlyConversation(),
          })
          .select("id")
          .single();
        if (insErr || !row) {
          console.error("Journal opslaan mislukt:", insErr);
          meta.save_error = true;
          return meta;
        }
        meta.trade_id = row.id;

        // Screenshots uit alle user-berichten naar de privébucket (max 8)
        const imgs = incoming
          .filter((m) => m.role === "user")
          .flatMap((m) => m.images ?? [])
          .slice(0, 8);
        const paths: string[] = [];
        for (let i = 0; i < imgs.length; i++) {
          const path = `${uid}/${row.id}/${i}.jpg`;
          const { error: upErr } = await supabase.storage
            .from("screenshots")
            .upload(path, base64ToBytes(imgs[i].data), { contentType: imgs[i].media_type });
          if (!upErr) paths.push(path);
          else console.error("Screenshot upload mislukt:", upErr);
        }
        if (paths.length) {
          await supabase.from("trades").update({ screenshots: paths }).eq("id", row.id);
        }
      } else if (savedTradeId) {
        // Gesprek bijwerken op de bestaande entry; resultaat-update toepassen indien aanwezig
        const patch: Record<string, unknown> = { gesprek: textOnlyConversation() };
        if (update) {
          const uitkomst = validateUitkomst(update.uitkomst);
          if (uitkomst !== "onbekend") {
            patch.uitkomst = uitkomst;
            patch.resultaat_r = validateR(update.resultaat_r);
            meta.updated = true;
          }
        }
        await supabase.from("trades").update(patch).eq("id", savedTradeId).eq("user_id", uid);
      }
    } catch (e) {
      console.error("Persist error:", e);
      meta.save_error = !savedTradeId && meta.trade_id == null ? true : meta.save_error;
    }
    return meta;
  }

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        // Opslag gebeurt server-side vóór het sluiten van de stream — tab dicht na dit punt kan geen kwaad
        const meta = await persist();
        if (upstreamErrored) (meta as any).stream_error = true;
        controller.enqueue(encoder.encode(META_SEP + JSON.stringify(meta)));
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
            upstreamErrored = true;
            console.error("Anthropic stream error:", event.error);
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
