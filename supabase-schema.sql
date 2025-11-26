-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

-- Create debates table
create table if not exists debates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  topic text not null,
  minimizer_response text not null,
  hawk_response text not null,
  minimizer_summary text,
  hawk_summary text,
  minimizer_model text not null,
  hawk_model text not null,
  sources jsonb default '[]'::jsonb
);

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

