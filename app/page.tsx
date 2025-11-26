"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { createClient, type Debate } from "./lib/supabase";

const AVAILABLE_MODELS = [
  "gpt-5.1-2025-11-13",
  "gpt-5-2025-08-07",
  "gpt-5-mini-2025-08-07",
  "gpt-5-nano-2025-08-07",
] as const;

type PersonaMeta = {
  id: string;
  name: string;
  color: string;
  model?: string;
};

type PersonaContent = PersonaMeta & {
  content: string;
};

type Source = {
  title: string;
  url: string;
  summary?: string;
};

type SelectionPopup = {
  text: string;
  x: number;
  y: number;
  personaName: string;
} | null;

export default function Home() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [responses, setResponses] = useState<Record<string, PersonaContent>>({});
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [minimizerModel, setMinimizerModel] = useState<string>("gpt-5.1-2025-11-13");
  const [hawkModel, setHawkModel] = useState<string>("gpt-5.1-2025-11-13");
  const [enableWebSearch, setEnableWebSearch] = useState(true);
  const [searchMode, setSearchMode] = useState<"trusted" | "wide" | "all">("wide");
  const [searchType, setSearchType] = useState<"fast" | "auto" | "neural">("auto");
  const [numResults, setNumResults] = useState(5);
  const [includeSummary, setIncludeSummary] = useState(false);

  // History state
  const [history, setHistory] = useState<Debate[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const supabase = useRef(createClient());

  // Selection popup state
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopup>(null);
  const [followupQuestion, setFollowupQuestion] = useState("");
  const [followupAnswer, setFollowupAnswer] = useState("");
  const [followupLoading, setFollowupLoading] = useState(false);
  const [followupError, setFollowupError] = useState<string | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Track accumulated content for summarization
  const accumulatedContent = useRef<Record<string, string>>({});
  const accumulatedSources = useRef<Source[]>([]);

  // Handle text selection
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      // Small delay to let selection finalize
      setTimeout(() => {
        // Ignore if clicking inside the popup
        if (popupRef.current?.contains(e.target as Node)) return;

        const selection = window.getSelection();
        const selectedText = selection?.toString().trim();

        if (!selectedText || selectedText.length < 10) {
          // Only close if clicking outside popup and no valid selection
          setSelectionPopup(null);
          setFollowupQuestion("");
          setFollowupAnswer("");
          setFollowupError(null);
          return;
        }

        // Check if selection is within a response card
        const range = selection?.getRangeAt(0);
        if (!range) return;

        const container = range.commonAncestorContainer;
        const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container as Element;
        const responseCard = element?.closest?.(".response-card");

        if (responseCard) {
          const personaName = responseCard.getAttribute("data-persona") || "Unknown";
          const rect = range.getBoundingClientRect();

          setSelectionPopup({
            text: selectedText.slice(0, 500), // Limit text length
            x: rect.left + rect.width / 2,
            y: rect.bottom + 10,
            personaName,
          });
          // Reset state for new selection
          setFollowupAnswer("");
          setFollowupQuestion("");
          setFollowupError(null);
        }
      }, 10);
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // Handle cmd+enter keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (!loading && topic.trim()) {
          e.preventDefault();
          const form = document.querySelector("form");
          form?.requestSubmit();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [loading, topic]);

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase.current
        .from("debates")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      setHistory(data || []);
    } catch (err) {
      console.error("Failed to load history:", err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const saveDebate = async (
    debateTopic: string,
    minimizerContent: string,
    hawkContent: string,
    minimizerSum: string | undefined,
    hawkSum: string | undefined,
    debateSources: Source[]
  ) => {
    try {
      const { error } = await supabase.current.from("debates").insert({
        topic: debateTopic,
        minimizer_response: minimizerContent,
        hawk_response: hawkContent,
        minimizer_summary: minimizerSum,
        hawk_summary: hawkSum,
        minimizer_model: minimizerModel,
        hawk_model: hawkModel,
        sources: debateSources,
      });

      if (error) throw error;
      // Refresh history
      loadHistory();
    } catch (err) {
      console.error("Failed to save debate:", err);
    }
  };

  const loadDebate = (debate: Debate) => {
    setTopic(debate.topic);
    setResponses({
      minimizer: {
        id: "minimizer",
        name: "The Minimizer",
        color: "#10b981",
        model: debate.minimizer_model,
        content: debate.minimizer_response,
      },
      compliance_hawk: {
        id: "compliance_hawk",
        name: "The Compliance Hawk",
        color: "#ef4444",
        model: debate.hawk_model,
        content: debate.hawk_response,
      },
    });
    setSummaries({
      minimizer: debate.minimizer_summary || "",
      compliance_hawk: debate.hawk_summary || "",
    });
    setSources(debate.sources || []);
    setMinimizerModel(debate.minimizer_model);
    setHawkModel(debate.hawk_model);
    setHistoryOpen(false);
  };

  const deleteDebate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { error } = await supabase.current.from("debates").delete().eq("id", id);
      if (error) throw error;
      setHistory((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error("Failed to delete debate:", err);
    }
  };

  // Handle followup question
  const handleFollowup = async () => {
    if (!selectionPopup || !followupQuestion.trim()) return;

    setFollowupLoading(true);
    setFollowupError(null);
    try {
      const res = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          highlightedText: selectionPopup.text,
          question: followupQuestion.trim(),
          personaContext: selectionPopup.personaName,
        }),
      });

      const data = await res.json();
      if (res.ok && data.answer) {
        setFollowupAnswer(data.answer);
      } else {
        setFollowupError(data.error || "Failed to get answer");
      }
    } catch (err) {
      console.error("Followup error:", err);
      setFollowupError("Network error - please try again");
    } finally {
      setFollowupLoading(false);
    }
  };

  const fetchSummaries = useCallback(async (contents: Record<string, string>): Promise<Record<string, string> | undefined> => {
    setSummarizing(true);
    try {
      const summaryPromises = Object.entries(contents).map(async ([personaId, content]) => {
        const res = await fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, personaId }),
        });
        if (res.ok) {
          const data = await res.json();
          return { personaId, summary: data.summary };
        }
        return { personaId, summary: null };
      });

      const results = await Promise.all(summaryPromises);
      const newSummaries: Record<string, string> = {};
      for (const { personaId, summary } of results) {
        if (summary) newSummaries[personaId] = summary;
      }
      setSummaries(newSummaries);
      return newSummaries;
    } catch (err) {
      console.error("Failed to fetch summaries:", err);
      return undefined;
    } finally {
      setSummarizing(false);
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!topic.trim() || loading) return;

      setLoading(true);
      setSearching(false);
      setError(null);
      setResponses({});
      setSummaries({});
      setSources([]);
      setSelectionPopup(null);
      accumulatedContent.current = {};
      accumulatedSources.current = [];

      try {
        const res = await fetch("/api/debate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: topic.trim(),
            minimizerModel,
            hawkModel,
            enableWebSearch,
            searchMode,
            searchType,
            numResults,
            includeSummary,
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to get debate responses");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = JSON.parse(line.slice(6));

              if (data.type === "searching") {
                setSearching(true);
              } else if (data.type === "sources") {
                setSources(data.sources);
                accumulatedSources.current = data.sources;
                setSearching(false);
              } else if (data.type === "init") {
                setSearching(false);
                const initial: Record<string, PersonaContent> = {};
                for (const p of data.personas) {
                  initial[p.id] = { ...p, content: "" };
                  accumulatedContent.current[p.id] = "";
                }
                setResponses(initial);
              } else if (data.type === "delta") {
                accumulatedContent.current[data.personaId] =
                  (accumulatedContent.current[data.personaId] || "") + data.delta;
                setResponses((prev) => ({
                  ...prev,
                  [data.personaId]: {
                    ...prev[data.personaId],
                    content: accumulatedContent.current[data.personaId],
                  },
                }));
              }
            }
          }
        }

        // Streaming done - now fetch summaries and save
        if (Object.keys(accumulatedContent.current).length > 0) {
          const finalContent = { ...accumulatedContent.current };
          const finalTopic = topic.trim();
          const finalSources = [...accumulatedSources.current];
          
          fetchSummaries(finalContent).then((newSums) => {
            // Save to Supabase after summaries are ready
            saveDebate(
              finalTopic,
              finalContent.minimizer || "",
              finalContent.compliance_hawk || "",
              newSums?.minimizer,
              newSums?.compliance_hawk,
              finalSources
            );
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
        setSearching(false);
      }
    },
    [topic, loading, minimizerModel, hawkModel, enableWebSearch, searchMode, searchType, numResults, includeSummary, fetchSummaries, saveDebate]
  );

  // Parse inline **bold** markdown
  const parseInlineBold = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={idx} className="font-semibold text-white">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  const formatContent = (content: string) => {
    return content.split("\n").map((line, i) => {
      // Section headers like **Position**: or **Key Points**:
      if (line.startsWith("**") && line.includes("**:")) {
        const match = line.match(/\*\*(.+?)\*\*:?\s*(.*)/);
        if (match) {
          return (
            <div key={i} className="mt-4 first:mt-0">
              <span className="font-semibold text-white">{match[1]}:</span>
              {match[2] && <span className="ml-1 text-zinc-300">{parseInlineBold(match[2])}</span>}
            </div>
          );
        }
      }
      // Bullet points
      if (line.startsWith("- ")) {
        return (
          <li key={i} className="ml-4 text-zinc-300">
            {parseInlineBold(line.slice(2))}
          </li>
        );
      }
      // Empty lines
      if (!line.trim()) return <div key={i} className="h-2" />;
      // Regular text
      return (
        <p key={i} className="text-zinc-300">
          {parseInlineBold(line)}
        </p>
      );
    });
  };

  const responseList = Object.values(responses);
  const hasResponses = responseList.length > 0;

  return (
    <div className="min-h-screen grid-bg">
      {/* History Toggle Button */}
      <button
        onClick={() => setHistoryOpen(!historyOpen)}
        className="fixed left-4 top-4 z-40 flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-sm text-zinc-300 backdrop-blur transition-colors hover:border-accent hover:text-white"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        History
        {history.length > 0 && (
          <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">
            {history.length}
          </span>
        )}
      </button>

      {/* History Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-80 transform border-r border-zinc-700 bg-zinc-900/95 backdrop-blur transition-transform duration-300 ${
          historyOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          {/* Sidebar Header */}
          <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-4">
            <h2 className="text-lg font-semibold text-white">Debate History</h2>
            <button
              onClick={() => setHistoryOpen(false)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Sidebar Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {loadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            ) : history.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">
                No debates yet. Start your first one!
              </p>
            ) : (
              <div className="space-y-2">
                {history.map((debate) => (
                  <div
                    key={debate.id}
                    onClick={() => loadDebate(debate)}
                    className="group cursor-pointer rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 transition-colors hover:border-accent/50 hover:bg-zinc-800"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 flex-1 text-sm text-zinc-200 group-hover:text-white">
                        {debate.topic}
                      </p>
                      <button
                        onClick={(e) => deleteDebate(debate.id, e)}
                        className="shrink-0 rounded p-1 text-zinc-500 opacity-0 transition-opacity hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"
                        title="Delete"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-[10px] text-zinc-500">
                      <span>{new Date(debate.created_at).toLocaleDateString()}</span>
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-minimizer" />
                        {debate.minimizer_model.split("-").slice(0, 2).join("-")}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-hawk" />
                        {debate.hawk_model.split("-").slice(0, 2).join("-")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar Footer */}
          <div className="border-t border-zinc-700 p-4">
            <button
              onClick={() => {
                setTopic("");
                setResponses({});
                setSummaries({});
                setSources([]);
                setHistoryOpen(false);
              }}
              className="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-accent hover:text-white"
            >
              + New Debate
            </button>
          </div>
        </div>
      </div>

      {/* Overlay when sidebar is open */}
      {historyOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setHistoryOpen(false)}
        />
      )}

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-12 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            SG Tax Debate
          </h1>
          <p className="mt-3 text-lg text-zinc-400">
            Two AI personas. Opposing views. One tax question.
          </p>
        </header>

        {/* Model Selectors */}
        <div className="mx-auto mb-6 grid max-w-3xl grid-cols-2 gap-4">
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
              <span className="h-2 w-2 rounded-full bg-minimizer" />
              The Minimizer
            </label>
            <select
              value={minimizerModel}
              onChange={(e) => setMinimizerModel(e.target.value)}
              disabled={loading}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-sm text-white focus:border-minimizer focus:outline-none focus:ring-1 focus:ring-minimizer disabled:opacity-50"
            >
              {AVAILABLE_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
              <span className="h-2 w-2 rounded-full bg-hawk" />
              The Compliance Hawk
            </label>
            <select
              value={hawkModel}
              onChange={(e) => setHawkModel(e.target.value)}
              disabled={loading}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-sm text-white focus:border-hawk focus:outline-none focus:ring-1 focus:ring-hawk disabled:opacity-50"
            >
              {AVAILABLE_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Exa Web Search Config */}
        <div className="mx-auto mb-6 max-w-3xl rounded-lg border border-zinc-700 bg-zinc-900/30 p-4">
          {/* Main toggle row */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <label className="flex cursor-pointer items-center gap-3">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={enableWebSearch}
                  onChange={(e) => setEnableWebSearch(e.target.checked)}
                  disabled={loading}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-zinc-700 peer-checked:bg-accent peer-disabled:opacity-50 transition-colors" />
                <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-300">Exa Web Search</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">BETA</span>
              </div>
            </label>

            {/* Summary toggle */}
            {enableWebSearch && (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeSummary}
                  onChange={(e) => setIncludeSummary(e.target.checked)}
                  disabled={loading}
                  className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-accent focus:ring-accent focus:ring-offset-0"
                />
                <span className="text-xs text-zinc-400">Include AI summaries</span>
              </label>
            )}
          </div>

          {/* Config options when enabled */}
          {enableWebSearch && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              {/* Sources */}
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Sources</label>
                <select
                  value={searchMode}
                  onChange={(e) => setSearchMode(e.target.value as "trusted" | "wide" | "all")}
                  disabled={loading}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 focus:border-accent focus:outline-none disabled:opacity-50"
                >
                  <option value="trusted">Trusted (IRAS, Big4)</option>
                  <option value="wide">Wide (+ legal, news)</option>
                  <option value="all">All web</option>
                </select>
              </div>

              {/* Search Type */}
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Search Type</label>
                <select
                  value={searchType}
                  onChange={(e) => setSearchType(e.target.value as "fast" | "auto" | "neural")}
                  disabled={loading}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 focus:border-accent focus:outline-none disabled:opacity-50"
                >
                  <option value="fast">Fast</option>
                  <option value="auto">Auto (balanced)</option>
                  <option value="neural">Neural (deep)</option>
                </select>
              </div>

              {/* Number of Results */}
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Results</label>
                <select
                  value={numResults}
                  onChange={(e) => setNumResults(Number(e.target.value))}
                  disabled={loading}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 focus:border-accent focus:outline-none disabled:opacity-50"
                >
                  <option value={3}>3 results</option>
                  <option value={5}>5 results</option>
                  <option value={8}>8 results</option>
                  <option value={10}>10 results</option>
                  <option value={15}>15 results</option>
                </select>
              </div>
            </div>
          )}

          {/* Description */}
          {enableWebSearch && (
            <p className="mt-3 text-xs text-zinc-500">
              {searchType === "fast" && "⚡ Fast search for quick results. "}
              {searchType === "auto" && "🔄 Auto-selects best search method. "}
              {searchType === "neural" && "🧠 Deep semantic search for comprehensive coverage. "}
              {searchMode === "trusted" && "Searches IRAS & Big4 tax firms."}
              {searchMode === "wide" && "Includes legal sites & tax publications."}
              {searchMode === "all" && "Unrestricted web search."}
              {includeSummary && " +AI summaries per source."}
            </p>
          )}
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="mx-auto mb-12 max-w-3xl">
          <div className="relative">
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Enter a Singapore tax topic, circular, or scenario to debate...

e.g., 'Section 14Q deduction for renovation costs' or 'IRAS e-Tax Guide on transfer pricing'"
              className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900/50 px-5 py-4 text-base text-white placeholder-zinc-500 backdrop-blur transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              rows={3}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !topic.trim()}
              className="absolute bottom-4 right-4 flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searching ? "Searching..." : loading ? "Debating..." : (
                <>
                  Start Debate
                  <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-medium">
                    <span className="text-xs">⌘</span>↵
                  </kbd>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="mx-auto mb-8 max-w-3xl rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-red-400">
            {error}
          </div>
        )}

        {/* Searching State */}
        {searching && (
          <div className="mx-auto mb-8 max-w-3xl">
            <div className="flex items-center justify-center gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span className="text-sm text-accent">
                Exa {searchType === "neural" ? "deep" : searchType} searching {searchMode === "trusted" ? "trusted sources" : searchMode === "wide" ? "tax resources" : "the web"} ({numResults} results)...
              </span>
            </div>
          </div>
        )}

        {/* Sources */}
        {sources.length > 0 && (
          <div className="mx-auto mb-8 max-w-3xl">
            <details className="group rounded-lg border border-zinc-700 bg-zinc-900/50">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300 hover:text-white">
                <span className="inline-flex items-center gap-2">
                  <svg className="h-4 w-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Exa found {sources.length} sources
                  <svg className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </summary>
              <div className="border-t border-zinc-700 px-4 py-3">
                <ul className="space-y-3">
                  {sources.map((source, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 text-[10px] text-zinc-500">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                          >
                            {source.title}
                          </a>
                          <span className="ml-2 text-zinc-500 text-xs">
                            {new URL(source.url).hostname}
                          </span>
                          {source.summary && (
                            <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                              {source.summary}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </div>
        )}

        {/* Hint for highlight feature */}
        {hasResponses && !loading && (
          <div className="mx-auto mb-4 max-w-3xl text-center">
            <p className="text-xs text-zinc-500">
              💡 Highlight any text in the responses to ask a follow-up question
            </p>
          </div>
        )}

        {/* Results / Streaming */}
        {hasResponses && (
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            {responseList.map((response) => (
              <div
                key={response.id}
                className="response-card flex flex-col overflow-hidden rounded-xl border-2 bg-card"
                style={{ borderColor: response.color }}
                data-persona={response.name}
              >
                {/* Header - prominent sticky header */}
                <div
                  className="shrink-0 border-b px-5 py-4"
                  style={{
                    backgroundColor: `${response.color}10`,
                    borderColor: `${response.color}30`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-lg"
                      style={{ backgroundColor: `${response.color}25` }}
                    >
                      {response.id === "minimizer" ? "💰" : "⚖️"}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-bold" style={{ color: response.color }}>
                        {response.name}
                      </h3>
                      {response.model && (
                        <span className="text-[10px] text-zinc-500">
                          {response.model}
                        </span>
                      )}
                    </div>
                    {(loading || summarizing) && (
                      <span
                        className="h-2 w-2 animate-pulse rounded-full"
                        style={{ backgroundColor: response.color }}
                      />
                    )}
                  </div>
                </div>

                {/* TL;DR Summary - outside scroll area */}
                {summaries[response.id] ? (
                  <div
                    className="mx-5 mt-4 mb-6 shrink-0 rounded-lg p-3 text-sm"
                    style={{ backgroundColor: `${response.color}12`, borderLeft: `3px solid ${response.color}` }}
                  >
                    <span className="font-semibold text-white">TL;DR: </span>
                    <span className="text-zinc-300">{summaries[response.id]}</span>
                  </div>
                ) : summarizing && !loading ? (
                  <div
                    className="mx-5 mt-4 mb-6 shrink-0 rounded-lg p-3 text-sm"
                    style={{ backgroundColor: `${response.color}12`, borderLeft: `3px solid ${response.color}` }}
                  >
                    <span className="text-zinc-400">Generating summary...</span>
                  </div>
                ) : null}

                {/* Scrollable content area - uses calc for explicit height */}
                <div 
                  className="scrollable-content flex-1 overflow-y-auto px-5 pb-5"
                  style={{ maxHeight: "calc(70vh - 140px)" }}
                >
                  <div className="response-content text-sm leading-relaxed select-text">
                    {response.content ? (
                      formatContent(response.content)
                    ) : (
                      <div className="space-y-3">
                        <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-700" />
                        <div className="h-4 w-full animate-pulse rounded bg-zinc-700" />
                        <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-700" />
                      </div>
                    )}
                  </div>

                  {/* Sources Reference */}
                  {sources.length > 0 && response.content && (
                    <div className="mt-6 border-t border-zinc-700/50 pt-4">
                      <p className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        Exa Sources Referenced
                      </p>
                      <div className="space-y-1">
                        {sources.map((source, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs">
                            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-zinc-800 text-[9px] text-zinc-500">
                              {i + 1}
                            </span>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="line-clamp-1 text-zinc-400 hover:text-accent hover:underline"
                              title={source.title}
                            >
                              {source.title}
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!hasResponses && !loading && !searching && (
          <div className="text-center text-zinc-500">
            <p>Enter a tax topic above to see two opposing perspectives</p>
          </div>
        )}
      </div>

      {/* Selection Popup */}
      {selectionPopup && (
        <div
          ref={popupRef}
          className="fixed z-50 w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
          style={{
            left: `clamp(1rem, ${selectionPopup.x - 192}px, calc(100vw - 25rem))`,
            top: `clamp(1rem, ${selectionPopup.y}px, calc(100vh - 20rem))`,
          }}
        >
          {/* Close button */}
          <button
            onClick={() => {
              setSelectionPopup(null);
              setFollowupQuestion("");
              setFollowupAnswer("");
              setFollowupError(null);
            }}
            className="absolute right-2 top-2 p-1 text-zinc-500 hover:text-white transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Highlighted text preview */}
          <div className="mb-3 rounded-lg bg-zinc-800 p-3 pr-8">
            <p className="text-xs text-zinc-500 mb-1">From {selectionPopup.personaName}:</p>
            <p className="text-sm text-zinc-300 line-clamp-3 italic">"{selectionPopup.text}"</p>
          </div>

          {/* Error message */}
          {followupError && (
            <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 p-2 text-sm text-red-400">
              {followupError}
            </div>
          )}

          {/* Question input - always show if no answer yet */}
          {!followupAnswer && (
            <div className="space-y-3">
              <input
                type="text"
                value={followupQuestion}
                onChange={(e) => setFollowupQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleFollowup();
                  }
                }}
                placeholder="Ask about this text..."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                autoFocus
                disabled={followupLoading}
              />
              <button
                onClick={handleFollowup}
                disabled={followupLoading || !followupQuestion.trim()}
                className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-black transition-all hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {followupLoading ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                    Thinking...
                  </>
                ) : (
                  "Ask GPT-5"
                )}
              </button>
            </div>
          )}

          {/* Answer */}
          {followupAnswer && (
            <div className="space-y-3">
              <div className="rounded-lg bg-accent/10 border border-accent/30 p-3 max-h-48 overflow-y-auto">
                <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{followupAnswer}</p>
              </div>
              <button
                onClick={() => {
                  setFollowupAnswer("");
                  setFollowupQuestion("");
                  setFollowupError(null);
                }}
                className="w-full rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
              >
                Ask another question
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
