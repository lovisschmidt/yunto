import { fetch as expoFetch } from "expo/fetch";
import { Parser } from "expr-eval";

export const TOOL_DEFINITIONS = [
  {
    name: "search_wikipedia",
    description:
      "Look up factual information on Wikipedia. Use for people, places, concepts, events, history. Do NOT use for recent news or time-sensitive information.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "get_datetime",
    description: "Return the current local date and time.",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "calculate",
    description:
      "Evaluate a mathematical expression. Supports +, -, *, /, ^ (exponentiation), sqrt(), parentheses.",
    input_schema: {
      type: "object" as const,
      properties: { expression: { type: "string" } },
      required: ["expression"],
    },
  },
];

async function searchWikipedia(query: string, signal: AbortSignal): Promise<string> {
  try {
    const searchUrl =
      `https://en.wikipedia.org/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1&origin=*`;
    const searchRes = await expoFetch(searchUrl, { signal });
    if (!searchRes.ok) return `No Wikipedia result found for: ${query}`;

    const searchData = (await searchRes.json()) as {
      query?: { search?: Array<{ title: string }> };
    };
    const title = searchData.query?.search?.[0]?.title;
    if (!title) return `No Wikipedia result found for: ${query}`;

    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryRes = await expoFetch(summaryUrl, { signal });
    if (!summaryRes.ok) return `No Wikipedia result found for: ${query}`;

    const summaryData = (await summaryRes.json()) as { extract?: string };
    const extract = summaryData.extract ?? "";
    if (!extract) return `No Wikipedia result found for: ${query}`;

    if (extract.length <= 300) return extract;
    const truncated = extract.slice(0, 300);
    const lastPeriod = truncated.lastIndexOf(". ");
    return lastPeriod > 100 ? truncated.slice(0, lastPeriod + 1) : truncated;
  } catch {
    return `No Wikipedia result found for: ${query}`;
  }
}

function getCurrentDatetime(): string {
  return new Date().toLocaleString();
}

function calculate(expression: string): string {
  try {
    const result = Parser.evaluate(expression);
    return String(result);
  } catch {
    return "Invalid expression";
  }
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> {
  switch (name) {
    case "search_wikipedia":
      return searchWikipedia(String(input.query ?? ""), signal);
    case "get_datetime":
      return getCurrentDatetime();
    case "calculate":
      return calculate(String(input.expression ?? ""));
    default:
      return `Unknown tool: ${name}`;
  }
}
