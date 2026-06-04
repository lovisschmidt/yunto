// HeadphoneButtonModule owns audio focus and the native AudioTrack — streamed PCM
// chunks are pushed to it so the same service that handles button events plays audio.
import HeadphoneButtonModule from "../../modules/headphone-button/index.js";

export const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel
export const MODEL_ID = "eleven_flash_v2_5";

export class TtsStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsStreamError";
  }
}

export interface TtsStreamOptions {
  apiKey: string;
  voiceId: string;
  modelId: string;
  sampleRate: number;
  speed: number;
  signal: AbortSignal;
  onFirstAudio: () => void; // fired once when the first PCM chunk is dispatched to native
}

export interface TtsStreamHandle {
  feed(text: string): void; // forward an LLM token; buffers until WS open
  end(): Promise<void>; // flush + resolve when AudioTrack has fully drained
  abort(): void; // immediate teardown (also bound to signal)
}

export function openTtsStream(opts: TtsStreamOptions): TtsStreamHandle {
  const { apiKey, voiceId, modelId, sampleRate, speed, signal, onFirstAudio } = opts;

  let ws: WebSocket | null = null;
  let open = false;
  let aborted = false;
  let audioStarted = false;
  let finalSettled = false;
  let flushRequested = false;
  // Unblocks end()'s playback-drain wait when abort() fires, since stopPcmStream
  // tears the track down without ever emitting onPlaybackComplete.
  let resolvePlayback: (() => void) | null = null;
  const pending: string[] = [];

  let resolveFinal!: () => void;
  let rejectFinal!: (err: Error) => void;
  const finalPromise = new Promise<void>((resolve, reject) => {
    resolveFinal = resolve;
    rejectFinal = reject;
  });
  // Keep an inert handler so an unawaited rejection (e.g. error after abort) never warns.
  finalPromise.catch(() => {});

  function settleFinalResolve() {
    if (finalSettled) return;
    finalSettled = true;
    resolveFinal();
  }

  function settleFinalReject(err: Error) {
    if (finalSettled) return;
    finalSettled = true;
    rejectFinal(err);
  }

  function send(payload: object) {
    try {
      ws?.send(JSON.stringify(payload));
    } catch {
      // onerror/onclose drive the failure path
    }
  }

  function mapCloseError(code: number, reason: string): TtsStreamError {
    const r = (reason || "").toLowerCase();
    if (
      code === 1008 ||
      r.includes("401") ||
      r.includes("unauthorized") ||
      r.includes("api_key") ||
      r.includes("api key")
    ) {
      return new TtsStreamError("Invalid ElevenLabs API key. Please check Settings.");
    }
    return new TtsStreamError("Audio generation failed. Please try again.");
  }

  function connect() {
    const url =
      `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input` +
      `?model_id=${modelId}&output_format=pcm_${sampleRate}&inactivity_timeout=60`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      open = true;
      send({
        text: " ",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        generation_config: { chunk_length_schedule: [120, 160, 250, 290] },
        "xi-api-key": apiKey,
      });
      for (const t of pending) send({ text: t });
      pending.length = 0;
      if (flushRequested) send({ text: "" });
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (aborted) return;
      let msg: { audio?: string | null; isFinal?: boolean };
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (msg.audio) {
        if (!audioStarted) {
          audioStarted = true;
          HeadphoneButtonModule.startPcmStream(sampleRate, speed);
          onFirstAudio();
        }
        HeadphoneButtonModule.feedPcm(msg.audio);
      }
      if (msg.isFinal === true) {
        settleFinalResolve();
      }
    };

    ws.onerror = () => {
      if (aborted) return;
      settleFinalReject(new TtsStreamError("Audio generation failed. Please try again."));
    };

    ws.onclose = (ev: CloseEvent) => {
      open = false;
      if (aborted || finalSettled) return;
      settleFinalReject(mapCloseError(ev.code, ev.reason));
    };
  }

  function feed(text: string) {
    if (aborted || !text) return;
    if (!ws) connect();
    if (open) {
      send({ text });
    } else {
      pending.push(text);
    }
  }

  async function end(): Promise<void> {
    if (aborted) return;
    // Tool-only / empty response: no token ever fed, WS never opened — nothing to drain.
    if (!ws) return;

    if (open) send({ text: "" });
    else flushRequested = true;

    await finalPromise; // rejects with TtsStreamError if the stream failed
    if (aborted) return;

    if (!audioStarted) {
      // isFinal arrived but no audio was produced — nothing to play.
      try {
        ws.close();
      } catch {
        // ignore
      }
      return;
    }

    await new Promise<void>((resolve) => {
      let sub: ReturnType<typeof HeadphoneButtonModule.addListener> | null = null;
      const finish = () => {
        sub?.remove();
        resolvePlayback = null;
        resolve();
      };
      resolvePlayback = finish;
      if (aborted) {
        finish();
        return;
      }
      sub = HeadphoneButtonModule.addListener("onPlaybackComplete", finish);
      HeadphoneButtonModule.endPcmStream();
    });

    try {
      ws.close();
    } catch {
      // ignore
    }
  }

  function abort() {
    if (aborted) return;
    aborted = true;
    HeadphoneButtonModule.stopPcmStream();
    try {
      ws?.close();
    } catch {
      // ignore
    }
    settleFinalResolve(); // settle pending promises without error
    resolvePlayback?.(); // release end()'s drain wait so the turn can be finalized
  }

  signal.addEventListener("abort", abort);

  return { feed, end, abort };
}
