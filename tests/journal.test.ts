import { extractJournal, validateJournal, validateR, validateUitkomst } from "../lib/journal";

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

console.log(failures === 0 ? "\nALLE TESTS GESLAAGD" : `\n${failures} TESTS GEFAALD`);
process.exit(failures === 0 ? 0 : 1);
