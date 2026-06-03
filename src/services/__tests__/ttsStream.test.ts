jest.mock("../../../modules/headphone-button/index.js", () => ({
  __esModule: true,
  default: {
    startPcmStream: jest.fn(),
    feedPcm: jest.fn(),
    endPcmStream: jest.fn(),
    stopPcmStream: jest.fn(),
    addListener: jest.fn(),
  },
}));

import HeadphoneButtonModule from "../../../modules/headphone-button/index.js";
import { openTtsStream, TtsStreamError, type TtsStreamOptions } from "../ttsStream.js";

// The mocked default export is the object we assert against.
const mockModule = HeadphoneButtonModule as unknown as {
  startPcmStream: jest.Mock;
  feedPcm: jest.Mock;
  endPcmStream: jest.Mock;
  stopPcmStream: jest.Mock;
  addListener: jest.Mock;
};

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  // test helpers
  triggerOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  triggerMessage(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  triggerClose(code: number, reason: string) {
    this.onclose?.({ code, reason });
  }
  triggerError() {
    this.onerror?.();
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

let playbackCompleteCb: (() => void) | null = null;

function makeOpts(overrides: Partial<TtsStreamOptions> = {}): TtsStreamOptions {
  return {
    apiKey: "test-key",
    voiceId: "voice-1",
    modelId: "model-1",
    sampleRate: 22050,
    speed: 1,
    signal: new AbortController().signal,
    onFirstAudio: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  MockWebSocket.instances = [];
  playbackCompleteCb = null;
  jest.clearAllMocks();
  mockModule.addListener.mockImplementation((event: string, cb: () => void) => {
    if (event === "onPlaybackComplete") playbackCompleteCb = cb;
    return { remove: jest.fn() };
  });
  (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
});

describe("openTtsStream", () => {
  it("sends the init message with the API key inside it, then flushes queued text on open", () => {
    const handle = openTtsStream(makeOpts());
    handle.feed("Hello");
    const ws = MockWebSocket.instances[0]!;

    // nothing sent until the socket opens
    expect(ws.sent.length).toBe(0);

    ws.triggerOpen();

    const init = JSON.parse(ws.sent[0]!);
    expect(init.text).toBe(" ");
    expect(init["xi-api-key"]).toBe("test-key");
    expect(init.voice_settings).toEqual({ stability: 0.5, similarity_boost: 0.75 });
    expect(init.generation_config.chunk_length_schedule).toEqual([120, 160, 250, 290]);

    expect(JSON.parse(ws.sent[1]!)).toEqual({ text: "Hello" });
  });

  it("builds the stream-input URL with model + pcm output format", () => {
    const handle = openTtsStream(makeOpts());
    handle.feed("x");
    expect(MockWebSocket.instances[0]!.url).toContain("/v1/text-to-speech/voice-1/stream-input");
    expect(MockWebSocket.instances[0]!.url).toContain("model_id=model-1");
    expect(MockWebSocket.instances[0]!.url).toContain("output_format=pcm_22050");
  });

  it("buffers feed() before open and sends immediately after open", () => {
    const handle = openTtsStream(makeOpts());
    handle.feed("a");
    const ws = MockWebSocket.instances[0]!;
    expect(ws.sent.length).toBe(0);

    ws.triggerOpen();
    expect(ws.sent.length).toBe(2); // init + buffered "a"

    handle.feed("b");
    expect(JSON.parse(ws.sent[2]!)).toEqual({ text: "b" });
  });

  it("skips empty tokens and never opens a socket for a tool-only response", async () => {
    const handle = openTtsStream(makeOpts());
    handle.feed("");
    expect(MockWebSocket.instances.length).toBe(0);
    await expect(handle.end()).resolves.toBeUndefined();
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it("starts the native PCM stream once on the first audio frame and feeds every frame", () => {
    const onFirstAudio = jest.fn();
    const handle = openTtsStream(makeOpts({ onFirstAudio }));
    handle.feed("x");
    const ws = MockWebSocket.instances[0]!;
    ws.triggerOpen();

    ws.triggerMessage({ audio: null }); // no audio payload — ignored
    expect(mockModule.startPcmStream).not.toHaveBeenCalled();

    ws.triggerMessage({ audio: "AAA" });
    expect(mockModule.startPcmStream).toHaveBeenCalledTimes(1);
    expect(mockModule.startPcmStream).toHaveBeenCalledWith(22050, 1);
    expect(onFirstAudio).toHaveBeenCalledTimes(1);
    expect(mockModule.feedPcm).toHaveBeenCalledWith("AAA");

    ws.triggerMessage({ audio: "BBB" });
    expect(mockModule.startPcmStream).toHaveBeenCalledTimes(1);
    expect(onFirstAudio).toHaveBeenCalledTimes(1);
    expect(mockModule.feedPcm).toHaveBeenCalledTimes(2);
    expect(mockModule.feedPcm).toHaveBeenLastCalledWith("BBB");
  });

  it("end() flushes, waits for isFinal then onPlaybackComplete before resolving", async () => {
    const handle = openTtsStream(makeOpts());
    handle.feed("x");
    const ws = MockWebSocket.instances[0]!;
    ws.triggerOpen();
    ws.triggerMessage({ audio: "AAA" });

    const endPromise = handle.end();
    expect(JSON.parse(ws.sent[ws.sent.length - 1]!)).toEqual({ text: "" });

    let resolved = false;
    endPromise.then(() => {
      resolved = true;
    });

    await tick();
    expect(resolved).toBe(false);
    expect(mockModule.endPcmStream).not.toHaveBeenCalled();

    ws.triggerMessage({ isFinal: true });
    await tick();
    expect(mockModule.endPcmStream).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false); // still waiting for playback to drain

    playbackCompleteCb?.();
    await endPromise;
    expect(resolved).toBe(true);
    expect(ws.readyState).toBe(3); // socket closed
  });

  it("end() resolves without draining when isFinal arrives but no audio was produced", async () => {
    const handle = openTtsStream(makeOpts());
    handle.feed("x");
    const ws = MockWebSocket.instances[0]!;
    ws.triggerOpen();

    const endPromise = handle.end();
    ws.triggerMessage({ isFinal: true });
    await expect(endPromise).resolves.toBeUndefined();
    expect(mockModule.endPcmStream).not.toHaveBeenCalled();
    expect(ws.readyState).toBe(3);
  });

  it("abort() stops the native stream and closes the socket", () => {
    const handle = openTtsStream(makeOpts());
    handle.feed("x");
    const ws = MockWebSocket.instances[0]!;
    ws.triggerOpen();

    handle.abort();
    expect(mockModule.stopPcmStream).toHaveBeenCalledTimes(1);
    expect(ws.readyState).toBe(3);
  });

  it("aborting the signal tears down the stream", () => {
    const controller = new AbortController();
    const handle = openTtsStream(makeOpts({ signal: controller.signal }));
    handle.feed("x");
    const ws = MockWebSocket.instances[0]!;
    ws.triggerOpen();

    controller.abort();
    expect(mockModule.stopPcmStream).toHaveBeenCalledTimes(1);
    expect(ws.readyState).toBe(3);
  });

  it("end() rejects with TtsStreamError when the socket closes before isFinal", async () => {
    const handle = openTtsStream(makeOpts());
    handle.feed("x");
    const ws = MockWebSocket.instances[0]!;
    ws.triggerOpen();
    ws.triggerMessage({ audio: "AAA" });

    const endPromise = handle.end();
    ws.triggerClose(1006, "");
    await expect(endPromise).rejects.toBeInstanceOf(TtsStreamError);
  });

  it("maps an auth-style close reason to a key-specific error", async () => {
    const handle = openTtsStream(makeOpts());
    handle.feed("x");
    const ws = MockWebSocket.instances[0]!;
    ws.triggerOpen();

    const endPromise = handle.end();
    ws.triggerClose(1008, "unauthorized");
    await expect(endPromise).rejects.toThrow(/API key/);
  });

  it("end() rejects with TtsStreamError on socket error before isFinal", async () => {
    const handle = openTtsStream(makeOpts());
    handle.feed("x");
    const ws = MockWebSocket.instances[0]!;
    ws.triggerOpen();

    const endPromise = handle.end();
    ws.triggerError();
    await expect(endPromise).rejects.toBeInstanceOf(TtsStreamError);
  });
});
