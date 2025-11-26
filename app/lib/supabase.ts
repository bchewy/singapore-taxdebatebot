import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Types for our debates table
export type DebateRun = {
  id: string;
  minimizerModel: string;
  hawkModel: string;
  minimizerResponse: string;
  hawkResponse: string;
};

export type Debate = {
  id: string;
  created_at: string;
  topic: string;
  // Single run fields (null for best of N)
  minimizer_response?: string;
  hawk_response?: string;
  minimizer_summary?: string;
  hawk_summary?: string;
  minimizer_model?: string;
  hawk_model?: string;
  // Best of N fields
  is_best_of_n: boolean;
  runs?: DebateRun[];
  // Shared
  sources?: { title: string; url: string; summary?: string }[];
};

