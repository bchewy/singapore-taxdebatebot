import { NextRequest } from "next/server";
import OpenAI from "openai";
import Exa from "exa-js";
import { MINIMIZER, COMPLIANCE_HAWK, type Persona } from "@/app/lib/personas";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const exa = new Exa(process.env.EXA_API_KEY);

type SearchResult = {
  title: string;
  url: string;
  text?: string;
  summary?: string;
};

type SearchMode = "trusted" | "wide" | "all";
type SearchType = "fast" | "auto" | "neural";

const TRUSTED_DOMAINS = [
  "iras.gov.sg",
  "singaporelegaladvice.com",
  "kpmg.com",
  "pwc.com",
  "ey.com",
  "deloitte.com",
];

const WIDE_DOMAINS = [
  ...TRUSTED_DOMAINS,
  "taxathand.com",
  "accaglobal.com",
  "lexology.com",
  "mondaq.com",
  "tax.thomsonreuters.com",
  "internationaltaxreview.com",
  "mof.gov.sg",
  "edb.gov.sg",
];

type ExaSearchConfig = {
  searchMode: SearchMode;
  searchType: SearchType;
  numResults: number;
  includeSummary: boolean;
};

async function searchTaxContext(
  topic: string,
  config: ExaSearchConfig
): Promise<{ results: SearchResult[]; context: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const searchOptions: any = {
      type: config.searchType,
      numResults: config.numResults,
      text: { maxCharacters: 3000 },
    };

    // Add summary if requested
    if (config.includeSummary) {
      searchOptions.summary = { query: "Key tax implications and rulings" };
    }

    // Only add domain restrictions if not "all"
    if (config.searchMode === "trusted") {
      searchOptions.includeDomains = TRUSTED_DOMAINS;
    } else if (config.searchMode === "wide") {
      searchOptions.includeDomains = WIDE_DOMAINS;
    }
    // "all" = no domain restrictions

    const result = await exa.searchAndContents(
      `Singapore tax ${topic}`,
      searchOptions
    );

    const results: SearchResult[] = result.results.map((r) => {
      const item = r as { text?: string; summary?: string };
      return {
        title: r.title || "Untitled",
        url: r.url,
        text: item.text,
        summary: item.summary,
      };
    });

    // Build context with summaries if available
    const context = results
      .map((r, i) => {
        const summaryPart = r.summary ? `\nSUMMARY: ${r.summary}` : "";
        return `[Source ${i + 1}: ${r.title}]${summaryPart}\n${r.text || "No content available"}`;
      })
      .join("\n\n---\n\n");

    return { results, context };
  } catch (error) {
    console.error("Exa search error:", error);
    return { results: [], context: "" };
  }
}

async function* streamPersonaResponse(
  persona: Persona,
  topic: string,
  webContext: string,
  runId?: string
) {
  const contextPrompt = webContext
    ? `\n\nREFERENCE MATERIAL FROM WEB SEARCH:\n${webContext}\n\nUse the above reference material to inform your analysis where relevant. Cite specific sources when applicable.`
    : "";

  const stream = await openai.responses.create({
    model: persona.model,
    instructions: persona.instructions + contextPrompt,
    input: `Analyze this Singapore tax matter: ${topic}`,
    stream: true,
  });

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      yield {
        runId,
        personaId: persona.id,
        personaName: persona.name,
        color: persona.color,
        delta: event.delta,
      };
    }
  }
}

type RunConfig = {
  id: string;
  minimizerModel: string;
  hawkModel: string;
};

export async function POST(request: NextRequest) {
  try {
    const {
      topic,
      minimizerModel,
      hawkModel,
      enableWebSearch,
      searchMode = "wide",
      searchType = "auto",
      numResults = 5,
      includeSummary = false,
      runConfigs, // New: array of run configs for Best of N mode
    } = await request.json();

    if (!topic || typeof topic !== "string") {
      return new Response(JSON.stringify({ error: "Topic is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Determine if this is single run or multi-run mode
    const isMultiRun = Array.isArray(runConfigs) && runConfigs.length > 0;
    
    // Build the runs array
    const runs: Array<{ id: string; minimizer: Persona; hawk: Persona }> = isMultiRun
      ? (runConfigs as RunConfig[]).map((config) => ({
          id: config.id,
          minimizer: { ...MINIMIZER, model: config.minimizerModel },
          hawk: { ...COMPLIANCE_HAWK, model: config.hawkModel },
        }))
      : [
          {
            id: "single",
            minimizer: { ...MINIMIZER, model: minimizerModel || MINIMIZER.model },
            hawk: { ...COMPLIANCE_HAWK, model: hawkModel || COMPLIANCE_HAWK.model },
          },
        ];

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        // Optionally search for web context first (shared across all runs)
        let webContext = "";
        let sources: SearchResult[] = [];

        if (enableWebSearch) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "searching" })}\n\n`)
          );

          const searchResult = await searchTaxContext(topic, {
            searchMode,
            searchType,
            numResults: Math.min(Math.max(numResults, 3), 15),
            includeSummary,
          });
          webContext = searchResult.context;
          sources = searchResult.results;

          if (sources.length > 0) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "sources", sources })}\n\n`)
            );
          }
        }

        // Send initial metadata for all runs
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "init",
              isMultiRun,
              runs: runs.map((run) => ({
                id: run.id,
                personas: [
                  { id: run.minimizer.id, name: run.minimizer.name, color: run.minimizer.color, model: run.minimizer.model },
                  { id: run.hawk.id, name: run.hawk.name, color: run.hawk.color, model: run.hawk.model },
                ],
              })),
            })}\n\n`
          )
        );

        // Stream all runs in parallel
        const allStreamPromises: Promise<void>[] = [];

        for (const run of runs) {
          const minimizerStream = streamPersonaResponse(run.minimizer, topic, webContext, run.id);
          const hawkStream = streamPersonaResponse(run.hawk, topic, webContext, run.id);

          allStreamPromises.push(
            (async () => {
              for await (const chunk of minimizerStream) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "delta", ...chunk })}\n\n`)
                );
              }
            })()
          );

          allStreamPromises.push(
            (async () => {
              for await (const chunk of hawkStream) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "delta", ...chunk })}\n\n`)
                );
              }
            })()
          );
        }

        await Promise.all(allStreamPromises);

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Debate API error:", error);
    return new Response(JSON.stringify({ error: "Failed to generate debate responses" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
