# SG Tax Debate Bot

An interactive web application that generates balanced debate-style analyses of Singapore tax questions from two opposing AI personas.

## Overview

Tax Debate Bot pits two AI personas against each other to analyze Singapore tax topics:

- **The Minimizer** - An aggressive tax optimization specialist who seeks loopholes, exemptions, and edge cases
- **The Compliance Hawk** - A strict tax compliance advocate who prioritizes conservative interpretation and risk assessment

Enter a Singapore tax question, and get real-time streaming responses from both perspectives with web-sourced references.

## Features

- **Dual-Persona Debates** - Simultaneous streaming responses from opposing tax viewpoints
- **Web Research Integration** - Exa-powered search across IRAS, Big4 firms, and tax publications
- **Best of N Mode** - Run debates with multiple model combinations and compare side-by-side
- **Debate History** - Persistent storage with Supabase, load or delete past debates
- **Follow-up Q&A** - Highlight text and ask contextual questions about specific passages
- **Auto-Summaries** - TL;DR summaries generated for each response
- **Configurable Search** - Trusted sources only, wide search, or unrestricted web search
- **Compact View** - Toggle between full and condensed response layouts

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| LLM | OpenAI GPT-5 |
| Search | Exa Search API |
| Database | Supabase (PostgreSQL) |
| Runtime | Node.js / Bun |

## Prerequisites

- Node.js 18+ or Bun
- OpenAI API key
- Exa Search API key
- Supabase project

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd taxdebatebot

# Install dependencies
bun install
# or
npm install
```

## Environment Variables

Create a `.env` file in the project root:

```env
# Required
OPENAI_API_KEY=sk-proj-...
EXA_API_KEY=your-exa-api-key
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...

# Optional
GEMINI_API_KEY=AIza...
```

| Variable | Description | Visibility |
|----------|-------------|------------|
| `OPENAI_API_KEY` | OpenAI API key for GPT-5 models | Server only |
| `EXA_API_KEY` | Exa web search API key | Server only |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | Public |

## Database Setup

1. Create a new Supabase project
2. Run the schema in the SQL Editor:

```sql
create table if not exists debates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  topic text not null,
  minimizer_response text,
  hawk_response text,
  minimizer_summary text,
  hawk_summary text,
  minimizer_model text,
  hawk_model text,
  is_best_of_n boolean default false,
  runs jsonb default null,
  sources jsonb default '[]'::jsonb
);

alter table debates enable row level security;

create policy "Allow public read" on debates
  for select to anon using (true);

create policy "Allow public insert" on debates
  for insert to anon with check (true);

create policy "Allow public delete" on debates
  for delete to anon using (true);

create index if not exists debates_created_at_idx on debates (created_at desc);
```

Or run the included schema file:
```bash
# Via Supabase CLI
supabase db push < supabase-schema.sql
```

## Running the Application

```bash
# Development (with hot reload)
bun dev
# or
npm run dev

# Production build
bun run build && bun start
# or
npm run build && npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
taxdebatebot/
├── app/
│   ├── page.tsx              # Main application UI
│   ├── layout.tsx            # Root layout
│   ├── globals.css           # Global styles + Tailwind
│   ├── lib/
│   │   ├── supabase.ts       # Supabase client & types
│   │   └── personas.ts       # Persona system prompts
│   └── api/
│       ├── debate/route.ts   # Streaming debate endpoint
│       ├── summarize/route.ts # Summary generation
│       └── followup/route.ts  # Follow-up Q&A
├── public/                    # Static assets
├── supabase-schema.sql        # Database schema
├── PERSONAS.md                # Persona documentation
└── package.json
```

## API Routes

### POST /api/debate

Main debate generation endpoint with server-sent events streaming.

**Request:**
```json
{
  "topic": "Can I claim my home office as a business expense?",
  "minimizerModel": "gpt-5.1-2025-11-13",
  "hawkModel": "gpt-5.1-2025-11-13",
  "searchEnabled": true,
  "searchMode": "trusted",
  "searchType": "auto",
  "numResults": 5
}
```

**Events:** `searching`, `sources`, `init`, `delta`, `done`

### POST /api/summarize

Generate TL;DR summaries for responses.

### POST /api/followup

Answer questions about highlighted text passages.

## Personas

See [PERSONAS.md](./PERSONAS.md) for detailed persona specifications.

Both personas respond in a structured format:
- **Position** - One-liner stance on the tax matter
- **Key Points** - Specific citations and provisions
- **Risk/Opportunity** - Assessment of the position
- **IRAS Likely View** - Expected regulatory perspective

## Search Modes

| Mode | Sources |
|------|---------|
| **Trusted** | IRAS, KPMG, PwC, EY, Deloitte |
| **Wide** | Trusted + Mondaq, Lexology, Thomson Reuters |
| **All** | Unrestricted web search |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Enter` | Submit query |

## Deployment

### Vercel (Recommended)

```bash
vercel deploy
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Environment

Set all environment variables in your deployment platform's settings.

## License

Private - All rights reserved.
