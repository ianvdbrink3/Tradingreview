export type JournalData = {
  datum: string;
  markt: string;
  sessie: string;
  richting: string;
  setup: string;
  entry_reden: string;
  fouten: string;
  fout_tags: string[];
  les: string;
  actiepunt: string;
  discipline_score: number | null;
  rr_gepland: string;
  uitkomst: string;
  resultaat_r: number | null;
};

export type Trade = {
  id: string;
  user_id: string;
  created_at: string;
  trade_date: string;
  markt: string;
  sessie: string;
  richting: string;
  setup: string;
  entry_reden: string;
  fouten: string;
  fout_tags: string[];
  les: string;
  actiepunt: string;
  discipline_score: number | null;
  rr_gepland: string;
  uitkomst: string;
  resultaat_r: number | null;
  review_md: string;
  context: string;
  screenshots: string[];
  gesprek: { role: string; text: string }[] | null;
};

export type ChatImage = { media_type: string; data: string };

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  images?: ChatImage[];
};
