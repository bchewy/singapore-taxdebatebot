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

async function* streamPersonaResponse(persona: Persona, topic: string, webContext: string) {
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
        personaId: persona.id,
        personaName: persona.name,
        color: persona.color,
        delta: event.delta,
      };
    }
  }
}

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
    } = await request.json();

    if (!topic || typeof topic !== "string") {
      return new Response(JSON.stringify({ error: "Topic is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Override models if provided
    const minimizerWithModel = { ...MINIMIZER, model: minimizerModel || MINIMIZER.model };
    const hawkWithModel = { ...COMPLIANCE_HAWK, model: hawkModel || COMPLIANCE_HAWK.model };

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        // Optionally search for web context first
        let webContext = "";
        let sources: SearchResult[] = [];

        if (enableWebSearch) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "searching" })}\n\n`)
          );

          const searchResult = await searchTaxContext(topic, {
            searchMode,
            searchType,
            numResults: Math.min(Math.max(numResults, 3), 15), // clamp 3-15
            includeSummary,
          });
          webContext = searchResult.context;
          sources = searchResult.results;

          // Send sources to frontend
          if (sources.length > 0) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "sources", sources })}\n\n`)
            );
          }
        }

        // Send initial metadata for both personas
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "init",
              personas: [
                { id: minimizerWithModel.id, name: minimizerWithModel.name, color: minimizerWithModel.color, model: minimizerWithModel.model },
                { id: hawkWithModel.id, name: hawkWithModel.name, color: hawkWithModel.color, model: hawkWithModel.model },
              ],
            })}\n\n`
          )
        );

        // Stream both personas in parallel
        const minimizerStream = streamPersonaResponse(minimizerWithModel, topic, webContext);
        const hawkStream = streamPersonaResponse(hawkWithModel, topic, webContext);

        const streamPromises = [
          (async () => {
            for await (const chunk of minimizerStream) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "delta", ...chunk })}\n\n`)
              );
            }
          })(),
          (async () => {
            for await (const chunk of hawkStream) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "delta", ...chunk })}\n\n`)
              );
            }
          })(),
        ];

        await Promise.all(streamPromises);

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
