import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { highlightedText, question, personaContext } = await request.json();

    if (!highlightedText || !question) {
      return NextResponse.json(
        { error: "Highlighted text and question are required" },
        { status: 400 }
      );
    }

    const response = await openai.responses.create({
      model: "gpt-5-2025-08-07",
      instructions: `You are a Singapore tax expert assistant. The user has highlighted a specific passage from a tax analysis and wants clarification.

Be concise and direct - aim for 2-4 sentences unless the question requires more detail. Focus specifically on what was asked about the highlighted text.

${personaContext ? `\nContext about the source: This was from "${personaContext}" persona's analysis.` : ""}`,
      input: `HIGHLIGHTED TEXT:
"${highlightedText}"

USER'S QUESTION:
${question}`,
    });

    return NextResponse.json({
      answer: response.output_text,
    });
  } catch (error) {
    console.error("Followup API error:", error);
    return NextResponse.json(
      { error: "Failed to get answer" },
      { status: 500 }
    );
  }
}

