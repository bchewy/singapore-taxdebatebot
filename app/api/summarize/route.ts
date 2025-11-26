import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { content, personaId } = await request.json();

    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const response = await openai.responses.create({
      model: "gpt-5-nano-2025-08-07", // Fast model for summaries
      instructions: `You are a concise summarizer. Given a tax analysis response, provide a 1-2 sentence TL;DR that captures the core stance and key takeaway. Be direct and punchy. No fluff.`,
      input: content,
    });

    return NextResponse.json({
      personaId,
      summary: response.output_text,
    });
  } catch (error) {
    console.error("Summarize API error:", error);
    return NextResponse.json({ error: "Failed to summarize" }, { status: 500 });
  }
}

