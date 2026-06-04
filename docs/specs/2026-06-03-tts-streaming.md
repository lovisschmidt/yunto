# Yunto — Real Streaming TTS Implementation Spec

> **Status:** Implemented (#20) · **Created:** 2026-06-03
> **Supersedes** the TTS pipeline (Steps 4–6) of [2026-05-15-prototype](./2026-05-15-prototype.md).
> **Point-in-time snapshot** of the plan as written; current behavior may have moved on. See the [spec index](./README.md).

## Context

The prototype's TTS is **per-chunk REST**: `pipeline.ts` buffers LLM tokens into sentence/40-token chunks, fires parallel `fetchTtsAudio()` REST calls that each return a complete MP3, writes each to a temp file, and the native module plays the files one at a time via Android `MediaPlayer` (`playUri`). Consequences: audible gaps between files, prosody resets at every chunk boundary, and first audio can't play until the first chunk has _fully_ generated and downloaded.

This spec replaces that with **real streaming** (the v2 "ElevenLabs streaming WebSocket" item): one WebSocket per assistant response, fed LLM tokens live, returning PCM audio continuously, played gaplessly through a native Android `AudioTrack`. This is the lowest-latency, most natural-prosody option and removes the file/gap machinery entirely.

Protocol verified against ElevenLabs docs (May 2026): WS `stream-input` endpoint, auth via `xi-api-key` **in the init message** (avoids React Native's unreliable WebSocket header support), default `output_format=pcm_22050`, init/text/flush message shapes and `{audio, isFinal}` responses as used below.

## Decisions Summary

| Decision                  | Choice                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Transport                 | ElevenLabs WS `stream-input`, **single continuous context** per response                                                  |
| Auth                      | `xi-api-key` field inside the init (BOS) message — not an HTTP header                                                     |
| Output format             | `pcm_22050` (22.05 kHz, 16-bit signed LE, mono) — available on all tiers                                                  |
| Playback engine           | Native Android **`AudioTrack`** (`MODE_STREAM`) in the existing headphone-button module                                   |
| WS protocol location      | **TypeScript** (`src/services/ttsStream.ts`); base64 PCM chunks pushed to native                                          |
| Chunk schedule            | Balanced default `chunk_length_schedule: [120, 160, 250, 290]`, raw token feed                                            |
| Connection timing         | Open WS at the **first LLM text token** (no pre-warm)                                                                     |
| WS failure                | Speak error + reset to idle; **delete the old REST path entirely** (single code path)                                     |
| Tool sequencing           | One continuous WS context across the whole turn; `"Searching"` hint **only if a tool fires before any audio has started** |
| Spoken hints              | Keep `"Thinking"`/`"Searching"`, stop the instant the first PCM chunk plays                                               |
| Interruption (focus loss) | Abort + reset to idle (discard remainder) — via a native focus-change listener                                            |
| Playback speed            | Keep existing setting via `AudioTrack` `PlaybackParams.setSpeed`                                                          |
| Waveform                  | Unchanged (decorative, status-driven)                                                                                     |
| Barge-in                  | Immediate `AudioTrack` pause+flush+stop, WS close, LLM abort                                                              |

## Architecture

```
LLM token stream (streamWithTools)
  → first text token: openTtsStream() connects WS, sends init message
  → each token: ws.send({ text: token })            (TS, ttsStream.ts)
  → ws receives { audio: base64 } frames continuously
      → first frame: native.startPcmStream(22050, speed) + onFirstAudio()  → status "speaking", Speech.stop()
      → every frame: native.feedPcm(base64)           (decode → enqueue → AudioTrack.write on writer thread)
  → LLM done: ws.send({ text: "" }) (flush) → await { isFinal } → native.endPcmStream()
      → AudioTrack drains → native emits onPlaybackComplete → tts.end() resolves
  → append assistant message, reset idle timer
```

Barge-in / cancel: `AbortController.abort()` → `ttsStream` closes WS + `native.stopPcmStream()` (immediate flush). Focus loss: native focus listener → `stopPcmStream()` + emits `onAudioInterrupted` → pipeline resets to idle.

### 1. WS protocol — `src/services/ttsStream.ts` (NEW)

Public surface:

```typescript
export class TtsStreamError extends Error {}

interface TtsStreamOptions {
  apiKey: string;
  voiceId: string; // "21m00Tcm4TlvDq8ikWAM" (Rachel)
  modelId: string; // "eleven_flash_v2_5"
  sampleRate: number; // 22050
  speed: number; // user playback speed
  signal: AbortSignal;
  onFirstAudio: () => void; // fired once when the first PCM chunk is dispatched to native
}

interface TtsStreamHandle {
  feed(text: string): void; // forward an LLM token; buffers until WS open
  end(): Promise<void>; // flush + resolve when AudioTrack has fully drained
  abort(): void; // immediate teardown (also bound to signal)
}

export function openTtsStream(opts: TtsStreamOptions): TtsStreamHandle;
```

Behavior:

- URL: `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${modelId}&output_format=pcm_22050&inactivity_timeout=60`. Use the RN global `WebSocket` (no `expo/fetch`).
- `onopen` → send init message, then flush any text queued before open:
  ```json
  {
    "text": " ",
    "voice_settings": { "stability": 0.5, "similarity_boost": 0.75 },
    "generation_config": { "chunk_length_schedule": [120, 160, 250, 290] },
    "xi-api-key": "<key>"
  }
  ```
- `feed(text)`: if socket not yet open, push to a pending array; else `ws.send(JSON.stringify({ text }))`. Send LLM deltas as-is (they carry their own spacing); skip empty strings.
- `onmessage`: `JSON.parse`. If `msg.audio`: on the **first** audio frame call `HeadphoneButtonModule.startPcmStream(sampleRate, speed)` then `onFirstAudio()`; then `HeadphoneButtonModule.feedPcm(msg.audio)` for every frame. If `msg.isFinal === true`: resolve the internal `finalReceived` promise.
- `end()`: `ws.send({ text: "" })`; await `finalReceived`; call `HeadphoneButtonModule.endPcmStream()`; await the native `onPlaybackComplete` event (subscribe once); close the socket; resolve. **No-op resolve if no audio was ever produced** (e.g. empty/tool-only response: WS may never have opened — guard for this).
- `abort()`: `HeadphoneButtonModule.stopPcmStream()`; `ws.close()`; settle pending promises without error. Bound to `opts.signal` via an `abort` listener so `abortRef.current.abort()` in the pipeline tears the stream down.
- Errors: `ws.onerror`, or `ws.onclose` before `isFinal` while not aborted, reject `end()` with `TtsStreamError("Audio generation failed. Please try again.")`. Map 401-style close reasons to a key message when available.

### 2. Native PCM player — headphone-button module (Kotlin)

`AudioTrack` replaces `MediaPlayer` for TTS. `MediaPlayer`/`playUri`/`stopPlayback` were used **only** for TTS files (confirmed: only `tts.ts` calls them) — remove them.

`HeadphoneButtonService.kt`:

- New fields: `audioTrack: AudioTrack?`, a single writer `Thread`, a `LinkedBlockingQueue<ByteArray>` (with a poison-pill sentinel), `totalFramesWritten: Long`, `streaming: Boolean`.
- `startPcmStream(sampleRate: Int, speed: Float)` (on a background-safe path):
  - `minBuf = AudioTrack.getMinBufferSize(sampleRate, CHANNEL_OUT_MONO, ENCODING_PCM_16BIT)`; bufferSize = `max(minBuf, minBuf * 4)`.
  - Build with `AudioTrack.Builder()` — `AudioAttributes` `USAGE_MEDIA` + `CONTENT_TYPE_SPEECH` (same as the old MediaPlayer), `AudioFormat` PCM_16BIT / mono / `sampleRate`, `MODE_STREAM`.
  - `play()`; if `Build.VERSION.SDK_INT >= M` and `speed != 1f`, `playbackParams = PlaybackParams().setSpeed(speed)` (try/catch).
  - Start writer thread: loop `queue.take()`; on sentinel break; else `audioTrack.write(bytes, 0, bytes.size)` (blocking → natural backpressure); accumulate `totalFramesWritten += bytes.size / 2`.
- `feedPcm(base64: String)` (sync `Function`, preserves JS call order): `Base64.decode(base64, Base64.DEFAULT)` → `queue.put(bytes)`. No-op if not streaming.
- `endPcmStream()`: enqueue sentinel. After the writer drains, poll `getPlaybackHeadPosition() < totalFramesWritten` (sleep ~20 ms) until reached or stopped, then `currentModule?.emitPlaybackComplete()` and release the track. (Underruns during a tool gap are fine — completion is only checked after the sentinel.)
- `stopPcmStream()`: set `streaming = false`, clear queue + enqueue sentinel/interrupt writer, `audioTrack.pause(); flush(); stop(); release()`. **No** `onPlaybackComplete` (used for barge-in/abort).
- **Focus listener**: attach an `OnAudioFocusChangeListener` to the existing `AudioFocusRequest`. On `AUDIOFOCUS_LOSS` / `AUDIOFOCUS_LOSS_TRANSIENT` while streaming → `stopPcmStream()` + `currentModule?.emitAudioInterrupted()`.
- Companion forwarders (`startPcmStream`/`feedPcm`/`endPcmStream`/`stopPcmStream`) mirroring the existing `playUri` pattern. Remove `mediaPlayer`, `playUri`, and the MediaPlayer `stopPlayback` body.

`HeadphoneButtonModule.kt`:

- Add to `Events(...)`: `"onAudioInterrupted"`. Keep `"onPlaybackComplete"`, `"onButtonEvent"`.
- Replace `Function("playUri")` / `Function("stopPlayback")` with `Function("startPcmStream")`, `Function("feedPcm")`, `Function("endPcmStream")`, `Function("stopPcmStream")`.
- Add `fun emitAudioInterrupted() = sendEvent("onAudioInterrupted", emptyMap<String, Any>())`.

`modules/headphone-button/src/HeadphoneButtonModule.ts`: replace `playUri`/`stopPlayback` decls with `startPcmStream(sampleRate: number, speed: number): void`, `feedPcm(base64: string): void`, `endPcmStream(): void`, `stopPcmStream(): void`.

`modules/headphone-button/src/HeadphoneButton.types.ts`: add `onAudioInterrupted: (params: Record<string, never>) => void;` to `HeadphoneButtonModuleEvents`.

Check `modules/headphone-button/android/src/main/AndroidManifest.xml`: ensure the foreground service declares `foregroundServiceType="mediaPlayback"` (and the matching `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permission) for Android 14 audio playback compliance.

### 3. Pipeline integration — `src/services/pipeline.ts`

Replace the token-buffer / `ttsQueue` / `flushBuffer` / `drainQueue` block (~lines 166–232) with the streaming session:

```typescript
let fullResponse = "";
let firstAudio = false;

const tts = openTtsStream({
  apiKey: keys.elevenLabsKey,
  voiceId: VOICE_ID,
  modelId: MODEL_ID,
  sampleRate: 22050,
  speed: playbackSpeed,
  signal: abort.signal,
  onFirstAudio: () => {
    firstAudio = true;
    Speech.stop();
    updateStatus("speaking");
  },
});

const llmStream = streamWithTools(
  session.messages,
  persona.systemPrompt,
  keys.anthropicKey,
  abort.signal,
  () => {
    if (!firstAudio) {
      Speech.stop();
      updateStatus("searching");
      Speech.speak("Searching", { language: "en" });
    }
  },
);

for await (const token of llmStream) {
  if (abort.signal.aborted) break;
  fullResponse += token;
  tts.feed(token);
}

if (!abort.signal.aborted) await tts.end(); // resolves after AudioTrack fully drains
if (abort.signal.aborted) return;
// ...existing appendMessage(assistant, fullResponse) + resetIdleTimer()...
```

- Keep the `"Thinking"` `Speech.speak` after STT unchanged. The `thinking → speaking` transition + `Speech.stop()` now happens in `onFirstAudio` (replaces the old `drainQueue` head).
- `catch`: add `TtsStreamError` to the `instanceof` chain (same `speakError` treatment as `TtsError` today).
- Subscribe to the native `onAudioInterrupted` event (in the existing `HeadphoneButtonModule` listener wiring) → call `cancelPipeline()` (abort + reset to idle; no message saved).
- `cancelAll()` already aborts `abortRef.current`; the `signal` listener inside `openTtsStream` tears down the WS + native track, so no extra ref plumbing is needed.
- Remove the `SENTENCE_END` and `MAX_CHUNK_TOKENS` exports/constants (no client chunking anymore). Move `VOICE_ID`/`MODEL_ID` constants from `tts.ts` to `ttsStream.ts`.

### 4. Removals

- Delete `src/services/tts.ts` (`fetchTtsAudio`, `playAudioFile`, `deleteTempFile`, `TtsError`). Its responsibilities move to `ttsStream.ts`.
- Remove the now-unused MediaPlayer code in the native service.
- No REST fallback, no feature flag — clean replacement.

### 5. Tests

- `src/services/__tests__/pipeline.test.ts` currently tests **only** the old chunking (`SENTENCE_END`, `MAX_CHUNK_TOKENS`, chunk simulation). Replace those with streaming-relevant assertions or remove the obsolete cases; update the `jest.mock("../tts.js", …)` to `"../ttsStream.js"`.
- Add `src/services/__tests__/ttsStream.test.ts`: mock `global.WebSocket` and `HeadphoneButtonModule`. Assert: init message shape + key placement on `onopen`; `feed()` buffers before open then sends after; first `{audio}` frame triggers `startPcmStream` + `onFirstAudio` exactly once; every frame calls `feedPcm`; `end()` sends `{text:""}`, waits for `isFinal` + `onPlaybackComplete`; `abort()`/signal abort calls `stopPcmStream` + closes socket; WS close before `isFinal` rejects with `TtsStreamError`.
- Native `AudioTrack` is not unit-testable → covered by manual device verification.

## Implementation Order

1. **Native PCM player** — add `AudioTrack` streaming (`startPcmStream`/`feedPcm`/`endPcmStream`/`stopPcmStream`), `onAudioInterrupted` event + focus listener; update module Kotlin, TS decl, and types; remove MediaPlayer/`playUri`. Verify manifest service type. Build (`npm run android`); smoke-test by feeding a hardcoded PCM buffer.
2. **`ttsStream.ts`** — WS protocol in TS, wired to the native player. Unit-test with mocked `WebSocket` + native module.
3. **Pipeline integration** — swap the chunking/REST block for `openTtsStream`; wire `onFirstAudio`, `onToolCall` suppression, and `onAudioInterrupted` → cancel; drop the old constants.
4. **Remove `tts.ts`**; update imports; fix/replace `pipeline.test.ts`.
5. **End-to-end device verification** (below).

## Verification

Run on a physical Android device (`npm run android`) with real BYOK keys in Settings:

- **Golden path:** press → speak → press. Audio starts shortly after the first LLM tokens and plays as one continuous, gapless utterance (no inter-sentence gaps like the old build).
- **Barge-in:** single-press while speaking → audio cuts **immediately** (buffer flushed, not after the buffered tail) and recording starts.
- **Cancel:** double-press while speaking → audio stops, returns to idle, no message saved beyond what completed.
- **Tool use (Agent persona):** ask a factual question (e.g. "what's the population of France?"). If the tool fires before any audio, `"Searching"` is spoken; once audio has started, no hint talks over it.
- **Interruption:** trigger an incoming call (or play another media app) mid-speech → audio stops and app returns to idle.
- **Playback speed:** change the speed setting → streamed speech honors it.
- **Errors:** invalid ElevenLabs key → spoken error, back to idle. Kill network mid-response → spoken error, back to idle.
- **Quality gates:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run fmt:check` all pass.

## Out of Scope (still v2+)

- WS multi-context endpoint, pre-warmed connections, reconnect/resume on failure.
- REST fallback path.
- Real-amplitude waveform (kept decorative).
- Voice selection / model routing / settings additions.
- MP3-over-WS output.
