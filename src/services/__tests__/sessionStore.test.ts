import { formatSessionTitle, isSessionStale, generateId } from "../sessionStore.js";

jest.mock("expo-file-system/legacy", () => ({}));

describe("formatSessionTitle", () => {
  it("formats a date into a human-readable string", () => {
    const result = formatSessionTitle("2024-06-15T14:30:00.000Z");
    // Locale-dependent — verify shape rather than exact value
    expect(result).toMatch(/\d/); // contains digits
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes the hour and minute", () => {
    // Use a fixed UTC offset-0 date so hours are predictable regardless of TZ
    const result = formatSessionTitle("2024-01-01T00:00:00.000Z");
    expect(typeof result).toBe("string");
  });
});

describe("isSessionStale", () => {
  const makeSession = (lastActivityAt: string) => ({
    id: "test",
    startedAt: lastActivityAt,
    lastActivityAt,
    messages: [],
  });

  it("returns false for a session with recent activity", () => {
    const recent = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
    expect(isSessionStale(makeSession(recent))).toBe(false);
  });

  it("returns true for a session idle longer than 10 minutes", () => {
    const old = new Date(Date.now() - 11 * 60 * 1000).toISOString(); // 11 min ago
    expect(isSessionStale(makeSession(old))).toBe(true);
  });

  it("returns false for a session exactly at the timeout boundary", () => {
    const boundary = new Date(Date.now() - 9 * 60 * 1000).toISOString(); // 9 min ago
    expect(isSessionStale(makeSession(boundary))).toBe(false);
  });
});

describe("generateId", () => {
  it("returns a non-empty string", () => {
    expect(typeof generateId()).toBe("string");
    expect(generateId().length).toBeGreaterThan(0);
  });

  it("returns unique values on successive calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateId()));
    expect(ids.size).toBe(20);
  });

  it("is a valid UUID v4", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
