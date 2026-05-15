// Mock all native/Expo deps so the module can load in Jest
jest.mock("expo-audio", () => ({
  useAudioRecorder: jest.fn(() => ({ prepareToRecordAsync: jest.fn(), record: jest.fn(), stop: jest.fn(), uri: null })),
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: jest.fn(),
}));
jest.mock("expo-speech", () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock("../sessionStore.js", () => ({}));
jest.mock("../settingsStore.js", () => ({}));
jest.mock("../../constants/personas.js", () => ({}));
jest.mock("../stt.js", () => ({}));
jest.mock("../llm.js", () => ({}));
jest.mock("../tts.js", () => ({}));
jest.mock("../sounds.js", () => ({}));

import { SENTENCE_END, MAX_CHUNK_TOKENS } from "../pipeline.js";

describe("SENTENCE_END regex", () => {
  it("matches a period followed by a space", () => {
    expect(SENTENCE_END.test("Hello world. Next")).toBe(true);
  });

  it("matches a question mark followed by a space", () => {
    expect(SENTENCE_END.test("How are you? Fine")).toBe(true);
  });

  it("matches an exclamation mark followed by a space", () => {
    expect(SENTENCE_END.test("Watch out! Now")).toBe(true);
  });

  it("matches an ellipsis followed by a space", () => {
    expect(SENTENCE_END.test("Well... okay")).toBe(true);
  });

  it("matches a double newline", () => {
    expect(SENTENCE_END.test("Paragraph one\n\nParagraph two")).toBe(true);
  });

  it("matches punctuation at end of string", () => {
    expect(SENTENCE_END.test("Done.")).toBe(true);
    expect(SENTENCE_END.test("Done?")).toBe(true);
    expect(SENTENCE_END.test("Done!")).toBe(true);
  });

  it("does not match mid-word punctuation", () => {
    // Period inside a number or abbreviation — no space after
    expect(SENTENCE_END.test("3.14")).toBe(false);
    expect(SENTENCE_END.test("U.S.A")).toBe(false);
  });

  it("does not match plain text without sentence-ending punctuation", () => {
    expect(SENTENCE_END.test("hello world")).toBe(false);
  });
});

describe("MAX_CHUNK_TOKENS", () => {
  it("is a positive number", () => {
    expect(MAX_CHUNK_TOKENS).toBeGreaterThan(0);
  });

  it("limits chunk size to prevent excessively long TTS requests", () => {
    // Verify the constant stays within a sensible range
    expect(MAX_CHUNK_TOKENS).toBeLessThanOrEqual(100);
  });
});

describe("TTS chunking simulation", () => {
  it("flushes when token count reaches MAX_CHUNK_TOKENS", () => {
    let tokenBuffer = "";
    let tokenCount = 0;
    const flushed: string[] = [];

    function flushBuffer() {
      const text = tokenBuffer.trim();
      if (!text) return;
      flushed.push(text);
      tokenBuffer = "";
      tokenCount = 0;
    }

    for (let i = 0; i < MAX_CHUNK_TOKENS; i++) {
      tokenBuffer += "word ";
      tokenCount++;
      if (SENTENCE_END.test(tokenBuffer) || tokenCount >= MAX_CHUNK_TOKENS) {
        flushBuffer();
      }
    }

    expect(flushed.length).toBe(1);
    expect(flushed[0]).toBe(("word ".repeat(MAX_CHUNK_TOKENS)).trim());
  });

  it("flushes early on sentence boundary before reaching MAX_CHUNK_TOKENS", () => {
    let tokenBuffer = "";
    let tokenCount = 0;
    const flushed: string[] = [];

    function flushBuffer() {
      const text = tokenBuffer.trim();
      if (!text) return;
      flushed.push(text);
      tokenBuffer = "";
      tokenCount = 0;
    }

    const tokens = ["Hello", " world", ".", " How", " are", " you", "?"];
    for (const token of tokens) {
      tokenBuffer += token;
      tokenCount++;
      if (SENTENCE_END.test(tokenBuffer) || tokenCount >= MAX_CHUNK_TOKENS) {
        flushBuffer();
      }
    }

    expect(flushed.length).toBe(2);
    expect(flushed[0]).toBe("Hello world.");
    expect(flushed[1]).toBe("How are you?");
  });
});
