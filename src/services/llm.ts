import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { fetch as expoFetch } from "expo/fetch";
import type { Message } from "./sessionStore.js";

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

export async function* streamResponse(
  messages: Message[],
  systemPrompt: string,
  anthropicKey: string,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const client = new Anthropic({
    apiKey: anthropicKey,
    fetch: expoFetch as typeof globalThis.fetch,
  });

  const formattedMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stream: any;
  try {
    stream = client.messages.stream(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        messages: formattedMessages,
      },
      { signal },
    );
  } catch (e: unknown) {
    if (e instanceof APIError) {
      if (e.status === 401) throw new LlmError("Invalid Anthropic API key. Please check Settings.");
      if (e.status === 429)
        throw new LlmError("Anthropic rate limit reached. Please wait a moment.");
      throw new LlmError(`Anthropic error ${e.status}: ${e.message}`);
    }
    throw new LlmError("Failed to connect to AI. Please try again.");
  }

  try {
    for await (const event of stream) {
      if (signal.aborted) break;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  } catch (e: unknown) {
    if (signal.aborted) return;
    if (e instanceof APIError) {
      if (e.status === 401) throw new LlmError("Invalid Anthropic API key. Please check Settings.");
      if (e.status === 429)
        throw new LlmError("Anthropic rate limit reached. Please wait a moment.");
      throw new LlmError(`Anthropic error ${e.status}: ${e.message}`);
    }
    throw new LlmError("AI response failed. Please try again.");
  }
}
