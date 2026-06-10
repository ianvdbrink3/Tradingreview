# NQ Trade Mentor

Trade review & journaling app volgens de methode van James. Studenten uploaden chart-screenshots van hun NQ-trades, voeren een gesprek met een strenge AI-mentor (Claude, vision + streaming) en bouwen automatisch een trading journal op met discipline-scores, foutpatronen en resultaten in R.

## Features
- **Review-gesprek**: screenshots uploaden (klik, drag & drop, of Ctrl+V plakken vanaf TradingView), gestructureerde context-velden, streaming review. Ontbreekt context, dan stelt de mentor eerst vragen — terugschrijven kan in dezelfde thread, inclusief extra screenshots ("stuur ook de 15m-chart").
- **Automatisch journal**: elke volledige review eindigt in een verborgen JSON-blok dat als entry wordt opgeslagen, inclusief discipline-score (1–10), fout-tags uit een vaste taxonomie, richting, gepland R:R en de chart-screenshots.
- **Journal-dashboard**: winrate, totaal R, gemiddelde discipline, discipline-trend (sparkline), meest gemaakte fouten met frequentie (klikbaar als filter), filters op uitkomst, en per entry een resultaat-editor om R achteraf bij te werken.
- **Live NY-sessieklok**: 08:30–12:00 EST venster met voortgang, in de nav en op login/review.

## Stack
- Next.js 15 (App Router) + TypeScript + Tailwind
- Supabase — auth (e-mail/wachtwoord), Postgres met RLS, Storage voor screenshots
- Anthropic API — server-side met streaming en prompt caching (geen client-side API key)

## Setup

Status van deze installatie:
- ✅ **Supabase**: project `nq-trade-mentor` (ref `gwngxwsjpjxtcsbtczwv`, regio eu-central-1) is aangemaakt en `supabase/schema.sql` is als migratie uitgevoerd (tabellen, RLS, storage-bucket + policies).
- ✅ **Publieke env vars**: staan in `.env.production` (Supabase-URL en anon key zijn publieke waarden; RLS beschermt de data) en worden automatisch meegebouwd.
- ⬜ **Vercel**: repo importeren via [vercel.com/new](https://vercel.com/new) → `ianvdbrink3/Tradingreview` kiezen → bij env vars alléén `ANTHROPIC_API_KEY` toevoegen → Deploy. `maxDuration = 300` op de review-route vereist Fluid Compute (standaard aan op nieuwe projecten).

Lokaal draaien: `.env.example` → `.env.local` invullen, dan `npm install && npm run dev`.

## Kennisbank
De JamesTrades mentorship-transcripten (Price Engineering, Precision Levels, EM-indicator) staan in `lib/kennisbank.ts` — **server-only**, zodat het cursusmateriaal nooit in de browser-bundle belandt. De methode-prompt zelf staat in `lib/system-prompt.ts` (dat bestand wordt wél client-side gebundeld via de fout-tags; zet er dus geen cursusinhoud in). Nieuwe transcripten/Discord-content plak je onderaan de `KENNISBANK`-constante in `lib/kennisbank.ts`; via prompt caching wordt dit maar één keer per 5 minuten volledig afgerekend. Hoofdstuk 2 (Manipulation) van het brondocument bevat alleen screenshots — zodra daar een transcript van is, kan die erbij. Bij 300+ pagina's: overweeg RAG met pgvector.

## Betrouwbaarheid
- **Server-side opslag**: het journal wordt op de server geparsed, gevalideerd en opgeslagen vóórdat de stream sluit. Tab dichtklappen na de review kan geen entry meer kosten.
- **Strikte validatie** van alle model-output (`lib/journal.ts`, gedekt door `npm test`): scores geclamped 1–10, fout-tags gefilterd op de vaste taxonomie, R-waarden begrensd, datums gecontroleerd. Ongeldige output vervuilt nooit de statistieken.
- **Rate limiting**: 30 berichten per gebruiker per uur (tabel `api_calls`), zodat een gedeelde API-key beschermd is.
- **Resultaat-capture**: meldt een student later in het gesprek "+2R gepakt", dan werkt de mentor de entry automatisch bij via een `<journal_update>`-blok (server-side gevalideerd).
- **Coach-integriteit**: de mentor geeft per system prompt nooit live entries, richtingen of voorspellingen, schat geen onleesbare levels van screenshots, en het gesprek wordt per entry gearchiveerd.
- **Robuuste client**: stream-abort bij wegnavigeren, waarschuwing bij sluiten tijdens een antwoord, getypte tekst en screenshots blijven behouden als een verzoek mislukt.

## Architectuur
1. Client comprimeert screenshots (canvas → JPEG, max 1568px) zodat payloads onder de Vercel-limiet blijven.
2. `/api/review` checkt de Supabase-sessie en stuurt de volledige gespreksgeschiedenis naar de Anthropic API (multi-turn), met `cache_control` op de system prompt.
3. De mentor geeft per gesprek precies één `<journal>{...}</journal>`-blok, direct na de eerste volledige review. De client parsed dit, slaat de entry op en uploadt de screenshots naar de privébucket (`{user_id}/{trade_id}/{i}.jpg`).
4. RLS op tabel én bucket: studenten zien uitsluitend hun eigen trades en screenshots.
