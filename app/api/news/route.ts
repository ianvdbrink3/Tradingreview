import { NextResponse } from "next/server";

// Red folder news (USD, high impact) deze week, via de publieke ForexFactory weekkalender-feed.
// Server-side geproxied met caching zodat de feed niet per bezoeker wordt aangeroepen.

// Route dynamisch (anders bakt de build een lege respons in); de upstream-fetch wordt wél 1 uur gecachet.
export const dynamic = "force-dynamic";

const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

type FFEvent = {
  title?: string;
  country?: string;
  date?: string; // ISO met offset
  impact?: string;
  forecast?: string;
  previous?: string;
};

export async function GET() {
  try {
    const res = await fetch(FEED, {
      next: { revalidate: 3600 },
      headers: { "User-Agent": "nq-trade-mentor (news calendar)" },
    });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const raw = (await res.json()) as FFEvent[];
    const events = (Array.isArray(raw) ? raw : [])
      .filter((e) => e.country === "USD" && e.impact === "High" && e.date && e.title)
      .map((e) => ({
        title: String(e.title).slice(0, 80),
        date: e.date as string,
        forecast: e.forecast || "",
        previous: e.previous || "",
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return NextResponse.json(
      { events },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" } }
    );
  } catch (e) {
    console.error("News feed error:", e);
    return NextResponse.json({ events: [], error: true }, { status: 200 });
  }
}
