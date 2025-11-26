-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

-- Create debates table
create table if not exists debates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  topic text not null,
  -- For single run mode
  minimizer_response text,
  hawk_response text,
  minimizer_summary text,
  hawk_summary text,
  minimizer_model text,
  hawk_model text,
  -- For best of N mode
  is_best_of_n boolean default false,
  runs jsonb default null, -- Array of { id, minimizerModel, hawkModel, minimizerResponse, hawkResponse }
  -- Shared
  sources jsonb default '[]'::jsonb
);

-- Migration for existing tables (run if table already exists):
-- alter table debates add column if not exists is_best_of_n boolean default false;
-- alter table debates add column if not exists runs jsonb default null;
-- alter table debates alter column minimizer_response drop not null;
-- alter table debates alter column hawk_response drop not null;
-- alter table debates alter column minimizer_model drop not null;
-- alter table debates alter column hawk_model drop not null;

-- Enable RLS
alter table debates enable row level security;

-- Allow public read/write (no auth for simplicity)
-- In production, you'd want proper auth!
create policy "Allow public read" on debates
  for select to anon using (true);

create policy "Allow public insert" on debates
  for insert to anon with check (true);

create policy "Allow public delete" on debates
  for delete to anon using (true);

-- Index for faster queries
create index if not exists debates_created_at_idx on debates (created_at desc);

