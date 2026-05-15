import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { fetch as expoFetch } from "expo/fetch";
import type { Message } from "./sessionStore.js";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";

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

  try {
    const stream = client.messages.stream(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        messages: formattedMessages,
      },
      { signal },
    );
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

export async function* streamWithTools(
  messages: Message[],
  systemPrompt: string,
  anthropicKey: string,
  signal: AbortSignal,
  onToolCall: (toolName: string) => void,
): AsyncGenerator<string> {
  const client = new Anthropic({
    apiKey: anthropicKey,
    fetch: expoFetch as typeof globalThis.fetch,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inFlightMessages: any[] = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  while (true) {
    if (signal.aborted) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let stream: any;
    try {
      stream = client.messages.stream(
        {
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: systemPrompt,
          messages: inFlightMessages,
          tools: TOOL_DEFINITIONS,
        },
        { signal },
      );
      for await (const event of stream) {
        if (signal.aborted) break;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
    } catch (e: unknown) {
      if (signal.aborted) return;
      if (e instanceof APIError) {
        if (e.status === 401)
          throw new LlmError("Invalid Anthropic API key. Please check Settings.");
        if (e.status === 429)
          throw new LlmError("Anthropic rate limit reached. Please wait a moment.");
        throw new LlmError(`Anthropic error ${e.status}: ${e.message}`);
      }
      throw new LlmError("AI response failed. Please try again.");
    }

    if (signal.aborted) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalMessage: any = await stream.finalMessage();
    if (finalMessage.stop_reason !== "tool_use") break;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUseBlocks: any[] = (finalMessage.content ?? []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (b: any) => b.type === "tool_use",
    );
    if (toolUseBlocks.length === 0) break;

    onToolCall(toolUseBlocks[0].name);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResults: any[] = [];
    for (const block of toolUseBlocks) {
      if (signal.aborted) return;
      const result = await executeTool(block.name, block.input ?? {}, signal);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    inFlightMessages.push({ role: "assistant", content: finalMessage.content });
    inFlightMessages.push({ role: "user", content: toolResults });
  }
}
