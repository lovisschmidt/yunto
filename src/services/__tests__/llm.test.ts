jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("../tools.js", () => ({
  TOOL_DEFINITIONS: [],
  executeTool: jest.fn(),
}));
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn(),
  APIError: class APIError extends Error {
    status: number;
    constructor(s: number, m: string) {
      super(m);
      this.status = s;
    }
  },
}));

import Anthropic from "@anthropic-ai/sdk";
import { streamResponse, streamWithTools } from "../llm.js";
import { executeTool } from "../tools.js";

const MockAnthropic = jest.mocked(Anthropic);
const mockExecuteTool = jest.mocked(executeTool);

let mockMessagesStream: jest.Mock;

function makeStream(events: object[], finalMessage: { stop_reason: string; content: object[] }) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const ev of events) yield ev;
    },
    finalMessage: jest.fn().mockResolvedValue(finalMessage),
  };
}

async function collectTokens(gen: AsyncGenerator<string>): Promise<string[]> {
  const tokens: string[] = [];
  for await (const t of gen) tokens.push(t);
  return tokens;
}

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExecuteTool.mockResolvedValue("tool result");
  mockMessagesStream = jest.fn();
  MockAnthropic.mockImplementation(
    () =>
      ({
        messages: { stream: mockMessagesStream },
      }) as any as Anthropic,
  );
});

// ─── streamResponse ───────────────────────────────────────────────────────────

describe("streamResponse", () => {
  it("yields text tokens from content_block_delta events", async () => {
    mockMessagesStream.mockReturnValue(
      makeStream(
        [
          { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
          { type: "content_block_delta", delta: { type: "text_delta", text: " world" } },
        ],
        { stop_reason: "end_turn", content: [] },
      ),
    );

    const tokens = await collectTokens(streamResponse([], "system", "key", makeSignal()));
    expect(tokens).toEqual(["Hello", " world"]);
  });

  it("ignores non-text events", async () => {
    mockMessagesStream.mockReturnValue(
      makeStream(
        [
          { type: "message_start", message: {} },
          { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } },
          { type: "message_stop" },
        ],
        { stop_reason: "end_turn", content: [] },
      ),
    );

    const tokens = await collectTokens(streamResponse([], "system", "key", makeSignal()));
    expect(tokens).toEqual(["hi"]);
  });

  it("stops yielding when signal is aborted mid-stream", async () => {
    const controller = new AbortController();
    mockMessagesStream.mockReturnValue(
      makeStream(
        [
          { type: "content_block_delta", delta: { type: "text_delta", text: "A" } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "B" } },
        ],
        { stop_reason: "end_turn", content: [] },
      ),
    );

    controller.abort();
    const tokens = await collectTokens(streamResponse([], "system", "key", controller.signal));
    expect(tokens.length).toBeLessThanOrEqual(1);
  });

  it("throws LlmError with key message on 401", async () => {
    const { APIError } = jest.requireMock("@anthropic-ai/sdk");
    mockMessagesStream.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        throw new APIError(401, "Unauthorized");
      },
    });

    await expect(collectTokens(streamResponse([], "system", "key", makeSignal()))).rejects.toThrow(
      "Invalid Anthropic API key",
    );
  });

  it("throws LlmError with rate-limit message on 429", async () => {
    const { APIError } = jest.requireMock("@anthropic-ai/sdk");
    mockMessagesStream.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        throw new APIError(429, "Rate limited");
      },
    });

    await expect(collectTokens(streamResponse([], "system", "key", makeSignal()))).rejects.toThrow(
      "rate limit",
    );
  });
});

// ─── streamWithTools ─────────────────────────────────────────────────────────

describe("streamWithTools", () => {
  const onToolCall = jest.fn();

  beforeEach(() => {
    onToolCall.mockReset();
  });

  it("yields text tokens when Claude responds without tool calls", async () => {
    mockMessagesStream.mockReturnValue(
      makeStream(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Direct answer" } }],
        { stop_reason: "end_turn", content: [{ type: "text", text: "Direct answer" }] },
      ),
    );

    const tokens = await collectTokens(
      streamWithTools([], "system", "key", makeSignal(), onToolCall),
    );
    expect(tokens).toEqual(["Direct answer"]);
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it("calls onToolCall and executeTool when stop_reason is tool_use", async () => {
    const toolBlock = {
      type: "tool_use",
      id: "tu_123",
      name: "calculate",
      input: { expression: "2 + 2" },
    };
    mockMessagesStream
      .mockReturnValueOnce(makeStream([], { stop_reason: "tool_use", content: [toolBlock] }))
      .mockReturnValueOnce(
        makeStream(
          [{ type: "content_block_delta", delta: { type: "text_delta", text: "The answer is 4" } }],
          { stop_reason: "end_turn", content: [] },
        ),
      );

    const tokens = await collectTokens(
      streamWithTools([], "system", "key", makeSignal(), onToolCall),
    );

    expect(onToolCall).toHaveBeenCalledWith("calculate");
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "calculate",
      { expression: "2 + 2" },
      expect.any(Object),
    );
    expect(tokens).toEqual(["The answer is 4"]);
  });

  it("passes tool result back to Claude as a tool_result message", async () => {
    mockExecuteTool.mockResolvedValue("42");
    const toolBlock = {
      type: "tool_use",
      id: "tu_456",
      name: "calculate",
      input: { expression: "6 * 7" },
    };

    mockMessagesStream
      .mockReturnValueOnce(makeStream([], { stop_reason: "tool_use", content: [toolBlock] }))
      .mockReturnValueOnce(
        makeStream([{ type: "content_block_delta", delta: { type: "text_delta", text: "42" } }], {
          stop_reason: "end_turn",
          content: [],
        }),
      );

    await collectTokens(streamWithTools([], "system", "key", makeSignal(), onToolCall));

    const secondCallMessages = mockMessagesStream.mock.calls[1][0].messages;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResultMsg = secondCallMessages.find(
      (m: any) => m.role === "user" && Array.isArray(m.content),
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tu_456",
      content: "42",
    });
  });

  it("handles multiple sequential tool calls across rounds", async () => {
    const block1 = { type: "tool_use", id: "t1", name: "calculate", input: { expression: "1+1" } };
    const block2 = { type: "tool_use", id: "t2", name: "get_datetime", input: {} };

    mockMessagesStream
      .mockReturnValueOnce(makeStream([], { stop_reason: "tool_use", content: [block1] }))
      .mockReturnValueOnce(makeStream([], { stop_reason: "tool_use", content: [block2] }))
      .mockReturnValueOnce(
        makeStream([{ type: "content_block_delta", delta: { type: "text_delta", text: "done" } }], {
          stop_reason: "end_turn",
          content: [],
        }),
      );

    const tokens = await collectTokens(
      streamWithTools([], "system", "key", makeSignal(), onToolCall),
    );

    expect(mockMessagesStream).toHaveBeenCalledTimes(3);
    expect(onToolCall).toHaveBeenCalledTimes(2);
    expect(tokens).toEqual(["done"]);
  });

  it("stops before executing tools when signal is aborted", async () => {
    const controller = new AbortController();
    const toolBlock = { type: "tool_use", id: "tu_789", name: "calculate", input: {} };
    mockMessagesStream.mockReturnValue(
      makeStream([], { stop_reason: "tool_use", content: [toolBlock] }),
    );
    controller.abort();

    await collectTokens(streamWithTools([], "system", "key", controller.signal, onToolCall));
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("throws LlmError on API 401", async () => {
    const { APIError } = jest.requireMock("@anthropic-ai/sdk");
    mockMessagesStream.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        throw new APIError(401, "Unauthorized");
      },
      finalMessage: jest.fn(),
    });

    await expect(
      collectTokens(streamWithTools([], "system", "key", makeSignal(), onToolCall)),
    ).rejects.toThrow("Invalid Anthropic API key");
  });
});
