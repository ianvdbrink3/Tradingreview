import { FOUT_TAGS } from "./system-prompt";
import type { JournalData } from "./types";

const UITKOMSTEN = ["winst", "verlies", "breakeven", "open", "onbekend"];
const RICHTINGEN = ["long", "short", "onbekend"];

export const CHECK_KEYS = [
  "zone_level",
  "el_sweep",
  "entry_trigger",
  "stop_plan",
  "binnen_venster",
  "plan_gevolgd",
] as const;

export const CHECK_LABELS: Record<(typeof CHECK_KEYS)[number], string> = {
  zone_level: "Precision level / zone",
  el_sweep: "EL geveegd",
  entry_trigger: "Entry trigger",
  stop_plan: "Stop volgens plan",
  binnen_venster: "Binnen sessievenster",
  plan_gevolgd: "Plan gevolgd",
};

export type Checks = Record<(typeof CHECK_KEYS)[number], boolean | null>;

/** Normaliseert het checks-object van het model: alleen de vaste keys, elk true/false/null. */
export function validateChecks(raw: unknown): Checks | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out = {} as Checks;
  let any = false;
  for (const k of CHECK_KEYS) {
    const v = src[k];
    out[k] = v === true ? true : v === false ? false : null;
    if (out[k] !== null) any = true;
  }
  return any ? out : null;
}

/** Deterministische discipline-score uit de checklist: 1 + round(9 * true / beoordeelbaar), geclamped 1–10. */
export function scoreFromChecks(checks: Checks | null): number | null {
  if (!checks) return null;
  let beoordeelbaar = 0;
  let voldaan = 0;
  for (const k of CHECK_KEYS) {
    if (checks[k] !== null) {
      beoordeelbaar++;
      if (checks[k]) voldaan++;
    }
  }
  if (beoordeelbaar === 0) return null;
  return Math.min(10, Math.max(1, 1 + Math.round((9 * voldaan) / beoordeelbaar)));
}

export function extractJournal(text: string): {
  clean: string;
  journal: Record<string, unknown> | null;
  update: Record<string, unknown> | null;
} {
  const jMatch = text.match(/<journal>([\s\S]*?)<\/journal>/);
  const uMatch = text.match(/<journal_update>([\s\S]*?)<\/journal_update>/);
  const clean = text
    .replace(/<journal>[\s\S]*?(<\/journal>|$)/, "")
    .replace(/<journal_update>[\s\S]*?(<\/journal_update>|$)/, "")
    .trim();
  let journal: Record<string, unknown> | null = null;
  let update: Record<string, unknown> | null = null;
  if (jMatch) {
    try {
      journal = JSON.parse(jMatch[1]);
    } catch {}
  }
  if (uMatch) {
    try {
      update = JSON.parse(uMatch[1]);
    } catch {}
  }
  return { clean, journal, update };
}

function str(v: unknown, max = 600): string {
  return typeof v === "string" ? v.slice(0, max).trim() : "";
}

function validDate(v: unknown): string {
  const today = new Date().toISOString().slice(0, 10);
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return today;
  const d = new Date(v + "T12:00:00Z");
  if (isNaN(d.getTime())) return today;
  // Geen datums in de toekomst of ouder dan 5 jaar
  const now = Date.now();
  if (d.getTime() > now + 86400000 || d.getTime() < now - 5 * 365 * 86400000) return today;
  return v;
}

export function validateUitkomst(v: unknown): string {
  return typeof v === "string" && UITKOMSTEN.includes(v) ? v : "onbekend";
}

export function validateR(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  if (!isFinite(n)) return null;
  // R buiten [-50, 50] is vrijwel zeker een invoer- of modelfout
  if (n < -50 || n > 50) return null;
  return Math.round(n * 100) / 100;
}

/** Valideert en normaliseert het journal-blok van het model. Ongeldige waarden worden veilig teruggebracht. */
export function validateJournal(raw: Record<string, unknown>): JournalData {
  const tags = Array.isArray(raw.fout_tags)
    ? raw.fout_tags.filter((t): t is string => typeof t === "string" && (FOUT_TAGS as readonly string[]).includes(t))
    : [];
  const checks = validateChecks(raw.checks);
  // Checklist is de bron van waarheid voor de score; de losse model-score is alleen fallback
  const modelScore =
    typeof raw.discipline_score === "number" && isFinite(raw.discipline_score)
      ? Math.min(10, Math.max(1, Math.round(raw.discipline_score)))
      : null;
  const score = scoreFromChecks(checks) ?? modelScore;
  const richting =
    typeof raw.richting === "string" && RICHTINGEN.includes(raw.richting) ? raw.richting : "onbekend";
  const entryTijd =
    typeof raw.entry_tijd === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(raw.entry_tijd.trim())
      ? raw.entry_tijd.trim()
      : "";

  return {
    datum: validDate(raw.datum),
    markt: str(raw.markt, 20) || "NQ",
    sessie: str(raw.sessie, 80),
    entry_tijd: entryTijd,
    richting,
    setup: str(raw.setup),
    entry_reden: str(raw.entry_reden),
    fouten: str(raw.fouten),
    fout_tags: tags.slice(0, 8),
    les: str(raw.les),
    actiepunt: str(raw.actiepunt),
    discipline_score: score,
    checks,
    rr_gepland: str(raw.rr_gepland, 20),
    uitkomst: validateUitkomst(raw.uitkomst),
    resultaat_r: validateR(raw.resultaat_r),
  };
}
