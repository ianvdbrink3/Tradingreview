"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import SessionClock from "./components/session-clock";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setInfo(null);
    setBusy(true);
    const supabase = createClient();
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError("Inloggen mislukt. Controleer je e-mail en wachtwoord.");
      else {
        router.push("/review");
        router.refresh();
      }
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError("Registreren mislukt: " + error.message);
      else setInfo("Account aangemaakt. Check je mail als bevestiging vereist is, en log daarna in.");
    }
    setBusy(false);
  }

  return (
    <div className="max-w-sm mx-auto mt-8">
      <div className="mb-6">
        <p className="font-mono text-xs text-session tracking-[0.2em] uppercase mb-3">
          Volgens de methode · NQ
        </p>
        <h1 className="text-[2rem] font-bold tracking-tight leading-[1.1]">
          Elke trade
          <br />
          een leerervaring.
        </h1>
        <p className="text-muted mt-3 text-sm leading-relaxed">
          Upload je chart, krijg een strenge review van de mentor en bouw automatisch een journal op
          met discipline-scores, foutpatronen en resultaten in R.
        </p>
      </div>

      <div className="mb-5">
        <SessionClock />
      </div>

      <div className="bg-panel border border-edge rounded-xl p-5">
        <div className="flex gap-1 mb-5 bg-ink rounded-lg p-1">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-1.5 rounded-md text-sm transition-colors ${
                mode === m ? "bg-panel text-paper" : "text-muted"
              }`}
            >
              {m === "login" ? "Inloggen" : "Registreren"}
            </button>
          ))}
        </div>

        <label className="block text-xs text-muted mb-1" htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-ink border border-edge rounded-lg px-3 py-2 mb-3 outline-none focus:border-session"
          placeholder="jij@voorbeeld.nl"
          autoComplete="email"
        />
        <label className="block text-xs text-muted mb-1" htmlFor="password">Wachtwoord</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full bg-ink border border-edge rounded-lg px-3 py-2 mb-4 outline-none focus:border-session"
          placeholder="••••••••"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />

        {error && <p className="text-short text-sm mb-3">{error}</p>}
        {info && <p className="text-long text-sm mb-3">{info}</p>}

        <button
          onClick={submit}
          disabled={busy || !email || !password}
          className="w-full bg-session text-ink font-semibold rounded-lg py-2.5 disabled:opacity-40 hover:brightness-110 transition"
        >
          {busy ? "Bezig…" : mode === "login" ? "Inloggen" : "Account aanmaken"}
        </button>
      </div>

      <p className="text-[11px] text-muted text-center mt-4">
        Reviews zijn coaching op proces en discipline — geen financieel advies.
      </p>
    </div>
  );
}
