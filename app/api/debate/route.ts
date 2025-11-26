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
};

async function searchTaxContext(topic: string): Promise<{ results: SearchResult[]; context: string }> {
  try {
    const result = await exa.searchAndContents(
      `Singapore tax IRAS ${topic}`,
      {
        type: "auto",
        numResults: 5,
        text: { maxCharacters: 2000 },
        includeDomains: ["iras.gov.sg", "taxguru.sg", "singaporelegaladvice.com", "kpmg.com", "pwc.com", "ey.com", "deloitte.com"],
      }
    );

    const results: SearchResult[] = result.results.map((r) => ({
      title: r.title || "Untitled",
      url: r.url,
      text: r.text,
    }));

    const context = results
      .map((r, i) => `[Source ${i + 1}: ${r.title}]\n${r.text || "No content available"}`)
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
    const { topic, minimizerModel, hawkModel, enableWebSearch } = await request.json();

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

          const searchResult = await searchTaxContext(topic);
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
