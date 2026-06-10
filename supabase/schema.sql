-- NQ Trade Mentor — database schema (v2)
-- Voer dit uit in de Supabase SQL Editor.

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  trade_date date not null default current_date,
  markt text not null default 'NQ',
  sessie text default '',
  richting text default 'onbekend',          -- long | short | onbekend
  setup text default '',
  entry_reden text default '',
  fouten text default '',
  fout_tags text[] default '{}',             -- vaste taxonomie, zie lib/system-prompt.ts
  les text default '',
  actiepunt text default '',
  discipline_score int,                      -- 1–10, procesdiscipline (niet resultaat)
  rr_gepland text default '',
  uitkomst text default 'onbekend',          -- winst | verlies | breakeven | open | onbekend
  resultaat_r numeric,                       -- resultaat in R, bijv. 2.5 of -1
  review_md text default '',
  context text default '',
  screenshots text[] default '{}'            -- storage-paden: {user_id}/{trade_id}/{i}.jpg
);

alter table public.trades enable row level security;

create policy "Eigen trades lezen"
  on public.trades for select
  using (auth.uid() = user_id);

create policy "Eigen trades aanmaken"
  on public.trades for insert
  with check (auth.uid() = user_id);

create policy "Eigen trades bijwerken"
  on public.trades for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Eigen trades verwijderen"
  on public.trades for delete
  using (auth.uid() = user_id);

create index if not exists trades_user_created_idx
  on public.trades (user_id, created_at desc);

-- Storage: privébucket voor chart-screenshots
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

create policy "Eigen screenshots uploaden"
  on storage.objects for insert
  with check (
    bucket_id = 'screenshots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Eigen screenshots lezen"
  on storage.objects for select
  using (
    bucket_id = 'screenshots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Eigen screenshots verwijderen"
  on storage.objects for delete
  using (
    bucket_id = 'screenshots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- v3: gesprek-archief op trades
alter table public.trades add column if not exists gesprek jsonb;

-- v3: rate limiting per gebruiker
create table if not exists public.api_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.api_calls enable row level security;

create policy "Eigen api calls lezen"
  on public.api_calls for select
  using (auth.uid() = user_id);

create policy "Eigen api calls registreren"
  on public.api_calls for insert
  with check (auth.uid() = user_id);

create index if not exists api_calls_user_time_idx
  on public.api_calls (user_id, created_at desc);

-- v4: coach-chat geschiedenis
create table if not exists public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  role text not null check (role in ('user', 'assistant')),
  content text not null
);

alter table public.coach_messages enable row level security;

create policy "Eigen coach messages lezen"
  on public.coach_messages for select
  using (auth.uid() = user_id);

create policy "Eigen coach messages aanmaken"
  on public.coach_messages for insert
  with check (auth.uid() = user_id);

create policy "Eigen coach messages verwijderen"
  on public.coach_messages for delete
  using (auth.uid() = user_id);

create index if not exists coach_messages_user_time_idx
  on public.coach_messages (user_id, created_at);
