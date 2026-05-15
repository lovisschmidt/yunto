jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

import { FetchResponse } from "expo/build/winter/fetch/FetchResponse.js";
import { fetch as expoFetch } from "expo/fetch";
import { executeTool, TOOL_DEFINITIONS } from "../tools.js";

const mockFetch = jest.mocked(expoFetch);

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

function mockWikipedia(searchTitle: string, extract: string) {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ query: { search: [{ title: searchTitle }] } }),
    } as any as FetchResponse)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ extract }),
    } as any as FetchResponse);
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("TOOL_DEFINITIONS", () => {
  it("defines the three expected tools", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain("search_wikipedia");
    expect(names).toContain("get_datetime");
    expect(names).toContain("calculate");
  });

  it("each tool has a non-empty description and input_schema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.input_schema).toBeDefined();
    }
  });
});

describe("executeTool — search_wikipedia", () => {
  it("returns extract text for a known query", async () => {
    mockWikipedia("Ada Lovelace", "Ada Lovelace was an English mathematician.");
    const result = await executeTool("search_wikipedia", { query: "Ada Lovelace" }, makeSignal());
    expect(result).toBe("Ada Lovelace was an English mathematician.");
  });

  it("truncates long extracts to ~300 chars at a sentence boundary", async () => {
    // Sentence boundary well past position 100, total extract > 300 chars
    const longExtract = "A".repeat(120) + ". " + "B".repeat(200);
    mockWikipedia("Some Article", longExtract);
    const result = await executeTool("search_wikipedia", { query: "something" }, makeSignal());
    expect(result.length).toBeLessThan(300);
    expect(result.endsWith(".")).toBe(true);
  });

  it("returns no-result message when search returns empty results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ query: { search: [] } }),
    } as any as FetchResponse);
    const result = await executeTool("search_wikipedia", { query: "xyzzy" }, makeSignal());
    expect(result).toMatch(/No Wikipedia result found/);
  });

  it("returns no-result message when search request fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false } as any as FetchResponse);
    const result = await executeTool("search_wikipedia", { query: "fail" }, makeSignal());
    expect(result).toMatch(/No Wikipedia result found/);
  });

  it("returns no-result message when summary request fails", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ query: { search: [{ title: "Something" }] } }),
      } as any as FetchResponse)
      .mockResolvedValueOnce({ ok: false } as any as FetchResponse);
    const result = await executeTool("search_wikipedia", { query: "something" }, makeSignal());
    expect(result).toMatch(/No Wikipedia result found/);
  });

  it("returns no-result message when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const result = await executeTool("search_wikipedia", { query: "error" }, makeSignal());
    expect(result).toMatch(/No Wikipedia result found/);
  });

  it("returns no-result message when extract is empty", async () => {
    mockWikipedia("Empty Article", "");
    const result = await executeTool("search_wikipedia", { query: "empty" }, makeSignal());
    expect(result).toMatch(/No Wikipedia result found/);
  });
});

describe("executeTool — get_datetime", () => {
  it("returns a non-empty string representing the current date/time", async () => {
    const result = await executeTool("get_datetime", {}, makeSignal());
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("result contains digits (year/time components)", async () => {
    const result = await executeTool("get_datetime", {}, makeSignal());
    expect(/\d/.test(result)).toBe(true);
  });
});

describe("executeTool — calculate", () => {
  it("evaluates basic arithmetic", async () => {
    expect(await executeTool("calculate", { expression: "2 + 2" }, makeSignal())).toBe("4");
    expect(await executeTool("calculate", { expression: "10 - 3" }, makeSignal())).toBe("7");
    expect(await executeTool("calculate", { expression: "6 * 7" }, makeSignal())).toBe("42");
    expect(await executeTool("calculate", { expression: "10 / 4" }, makeSignal())).toBe("2.5");
  });

  it("evaluates expressions with parentheses", async () => {
    expect(await executeTool("calculate", { expression: "(3 + 4) * 2" }, makeSignal())).toBe("14");
  });

  it("evaluates exponentiation with ^", async () => {
    expect(await executeTool("calculate", { expression: "2 ^ 10" }, makeSignal())).toBe("1024");
  });

  it("evaluates sqrt()", async () => {
    expect(await executeTool("calculate", { expression: "sqrt(16)" }, makeSignal())).toBe("4");
  });

  it("returns 'Invalid expression' for malformed input", async () => {
    expect(await executeTool("calculate", { expression: "not math" }, makeSignal())).toBe(
      "Invalid expression",
    );
  });

  it("returns 'Invalid expression' for empty string", async () => {
    expect(await executeTool("calculate", { expression: "" }, makeSignal())).toBe(
      "Invalid expression",
    );
  });
});

describe("executeTool — unknown tool", () => {
  it("returns an unknown-tool message", async () => {
    const result = await executeTool("nonexistent_tool", {}, makeSignal());
    expect(result).toMatch(/Unknown tool/);
  });
});
