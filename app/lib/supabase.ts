import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Types for our debates table
export type Debate = {
  id: string;
  created_at: string;
  topic: string;
  minimizer_response: string;
  hawk_response: string;
  minimizer_summary?: string;
  hawk_summary?: string;
  minimizer_model: string;
  hawk_model: string;
  sources?: { title: string; url: string; summary?: string }[];
};

