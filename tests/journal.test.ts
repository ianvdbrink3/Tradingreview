import {
  extractJournal,
  validateJournal,
  validateR,
  validateUitkomst,
  validateChecks,
  scoreFromChecks,
} from "../lib/journal";

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.log("FAIL:", name); }
  else console.log("ok  :", name);
}

// 1. Normaal journal-blok
const t1 = extractJournal(`## Trade Review\nGoede trade.\n<journal>{"datum":"2026-06-09","markt":"NQ","sessie":"NY","richting":"long","setup":"FVG","entry_reden":"MSS","fouten":"geen","fout_tags":["Geen fout"],"les":"x","actiepunt":"y","discipline_score":9,"rr_gepland":"1:3","uitkomst":"winst","resultaat_r":2.5}</journal>`);
check("journal geparsed", t1.journal !== null);
check("clean zonder blok", !t1.clean.includes("<journal>"));

// 2. Gedeeltelijk blok tijdens streaming verdwijnt uit clean
const t2 = extractJournal(`Review...\n<journal>{"datum":"2026`);
check("partieel blok gestript", !t2.clean.includes("<journal>") && t2.journal === null);

// 3. Kapotte JSON crasht niet
const t3 = extractJournal(`x<journal>{niet json}</journal>`);
check("kapotte JSON -> null", t3.journal === null);

// 4. Validatie: rare waarden worden genormaliseerd
const v = validateJournal({
  datum: "2099-01-01",            // toekomst -> vandaag
  richting: "LONG!!",             // ongeldig -> onbekend
  fout_tags: ["FOMO", "Verzonnen tag", 5],
  discipline_score: 47.9,         // -> 10
  uitkomst: "mega winst",         // -> onbekend
  resultaat_r: "2,5",             // komma -> 2.5
  setup: "a".repeat(2000),        // afgekapt
});
check("toekomstdatum -> vandaag", v.datum === new Date().toISOString().slice(0, 10));
check("richting genormaliseerd", v.richting === "onbekend");
check("alleen geldige tags", v.fout_tags.length === 1 && v.fout_tags[0] === "FOMO");
check("score geclamped 1-10", v.discipline_score === 10);
check("uitkomst genormaliseerd", v.uitkomst === "onbekend");
check("R met komma", v.resultaat_r === 2.5);
check("setup afgekapt", v.setup.length <= 600);

// 5. R-grenzen
check("R buiten bereik -> null", validateR(999) === null && validateR(-200) === null);
check("R null blijft null", validateR(null) === null);
check("R negatief ok", validateR(-1) === -1);

// 6. journal_update
const t6 = extractJournal(`Mooi resultaat.\n<journal_update>{"uitkomst":"winst","resultaat_r":2}</journal_update>`);
check("update geparsed", t6.update !== null && validateUitkomst(t6.update!.uitkomst) === "winst");
check("update gestript uit clean", !t6.clean.includes("journal_update"));

// 7. Score ontbreekt
const v7 = validateJournal({ discipline_score: "zeven" });
check("niet-numerieke score -> null", v7.discipline_score === null);

// 8. Checklist-score is deterministisch en overschrijft de model-score
const allTrue = validateChecks({
  zone_level: true, el_sweep: true, entry_trigger: true,
  stop_plan: true, binnen_venster: true, plan_gevolgd: true,
});
check("6/6 checks -> score 10", scoreFromChecks(allTrue) === 10);
const half = validateChecks({
  zone_level: true, el_sweep: false, entry_trigger: true,
  stop_plan: false, binnen_venster: true, plan_gevolgd: false,
});
check("3/6 checks -> score 6", scoreFromChecks(half) === 6); // 1 + round(9*3/6) = 5.5 -> 6
const metNull = validateChecks({ zone_level: true, el_sweep: null, entry_trigger: "ja" });
check("null/rommel telt niet mee", scoreFromChecks(metNull) === 10); // 1 beoordeelbaar, 1 true
check("alles null -> null", scoreFromChecks(validateChecks({ zone_level: null })) === null);
const v8 = validateJournal({
  discipline_score: 2, // model zegt 2, checklist zegt beter — checklist wint
  checks: { zone_level: true, el_sweep: true, entry_trigger: true, stop_plan: true, binnen_venster: true, plan_gevolgd: true },
});
check("checklist overschrijft model-score", v8.discipline_score === 10);
const v8b = validateJournal({ discipline_score: 4 });
check("zonder checks valt terug op model-score", v8b.discipline_score === 4 && v8b.checks === null);

// 9. Entry-tijd validatie
check("geldige entry_tijd", validateJournal({ entry_tijd: "09:47" }).entry_tijd === "09:47");
check("ongeldige entry_tijd -> leeg", validateJournal({ entry_tijd: "kwart over 9" }).entry_tijd === "");

console.log(failures === 0 ? "\nALLE TESTS GESLAAGD" : `\n${failures} TESTS GEFAALD`);
process.exit(failures === 0 ? 0 : 1);
