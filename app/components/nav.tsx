"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SessionClock from "./session-clock";

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  const items = [
    { href: "/review", label: "Review" },
    { href: "/journal", label: "Journal" },
  ];

  return (
    <nav className="flex items-center gap-1 text-sm">
      <div className="hidden sm:block mr-3">
        <SessionClock compact />
      </div>
      {items.map((it) => {
        const active = pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              active ? "bg-panel text-paper" : "text-muted hover:text-paper hover:bg-panel"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
      <button
        onClick={async () => {
          await createClient().auth.signOut();
          router.push("/");
          router.refresh();
        }}
        className="px-3 py-1.5 rounded-md text-muted hover:text-paper hover:bg-panel transition-colors"
        aria-label="Uitloggen"
      >
        Uitloggen
      </button>
    </nav>
  );
}
