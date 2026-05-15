# Yunto — Prototype Implementation Spec

## Overview

Voice-first AI companion for Android. Core loop: headphone button → record → Whisper STT → Claude stream → ElevenLabs TTS (per chunk, streaming playback). BYOK. No backend. Sessions persisted locally.

This spec covers the full prototype. Build in the order defined in [Implementation Order](#implementation-order).

---

## Decisions Summary

| Decision                | Choice                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| LLM provider            | Claude (Anthropic) only                                                      |
| STT                     | OpenAI Whisper REST API                                                      |
| TTS                     | ElevenLabs REST (per chunk)                                                  |
| Audio library           | expo-audio                                                                   |
| Key storage             | expo-secure-store                                                            |
| Session storage         | expo-file-system (JSON per session)                                          |
| Navigation              | React Navigation (stack)                                                     |
| TTS chunking            | Sentence boundaries + 40-token fallback                                      |
| Barge-in                | Stop all, start recording immediately                                        |
| Headphone button        | Single = toggle record; Double = cancel (if active) or new session (if idle) |
| Button debounce         | 300ms window                                                                 |
| Silence detection       | Not implemented (push-to-talk only)                                          |
| Session summary         | Deferred to v2                                                               |
| Context window handling | Ignored for prototype                                                        |
| Visual theme            | System-adaptive (dark/light)                                                 |
| Main screen             | Minimal: decorative waveform + status text                                   |
| Error handling          | Speak errors via expo-speech (Android TTS)                                   |
| Personas                | 3 hardcoded presets, no custom text                                          |
| ElevenLabs voice        | Hardcoded default (Rachel: `21m00Tcm4TlvDq8ikWAM`)                           |
| Session title           | Formatted start timestamp                                                    |
| Cold start              | Resume if last activity < 10 min ago, else new session                       |
| Idle reset              | 10-min timer, silent                                                         |

---

## Screens

Four screens, stack navigation:

```
HomeScreen (root)
├── SettingsScreen
├── SessionListScreen
│   └── SessionDetailScreen
```

---

## Dependencies to Install

```bash
npx expo install expo-audio expo-secure-store expo-speech expo-file-system
npm install @react-navigation/native @react-navigation/native-stack
npx expo install react-native-screens react-native-safe-area-context
npm install @anthropic-ai/sdk openai
```

---

## Home Screen

### Layout

```
┌─────────────────────────────┐
│                             │ ← safe area
│                             │
│                             │
│    ┌─────────────────┐      │
│    │  waveform bars  │      │ ← centered, ~120px tall
│    └─────────────────┘      │
│                             │
│       Listening...          │ ← status text, centered below waveform
│                             │
│                             │
│                             │ ← tap-to-record zone (invisible, full center area)
│                             │
│  Sessions  New Session  Settings  │ ← bottom row, text buttons
└─────────────────────────────┘
```

The entire area between the waveform and the bottom row is a `TouchableOpacity` that triggers the recording toggle (same behavior as single headphone press).

### States & Labels

| State                 | Status Text                                    | Waveform                              |
| --------------------- | ---------------------------------------------- | ------------------------------------- |
| `idle`                | "Tap or press headphone button"                | Static bars                           |
| `empty` (no API keys) | "Add your API keys in Settings to get started" | Static                                |
| `recording`           | "Listening..."                                 | Active animation (bars scale up/down) |
| `processing`          | "Processing..."                                | Gentle pulse                          |
| `thinking`            | "Thinking..."                                  | Gentle pulse                          |
| `speaking`            | "Speaking..."                                  | Active animation                      |
| `error`               | (spoken via expo-speech, then idle)            | Static                                |

### Waveform Animation

Decorative animated bars — not real audio amplitude data.

- 5 vertical bars, centered
- Idle: all bars at 30% height, no movement
- Active (recording/speaking): bars animate with staggered sine-wave scaling using `Animated.loop`
- Transition: `Animated.spring` between idle and active states

### Empty State

Shown when no API keys are configured (`ANTHROPIC_KEY`, `OPENAI_KEY`, `ELEVENLABS_KEY` all absent from secure store). The status text area shows the empty state message. The tap-to-record zone does nothing.

### Bottom Row

Three equal-width text buttons:

- **Sessions** → push `SessionListScreen`
- **New Session** → save current session, start new session, immediately start recording
- **Settings** → push `SettingsScreen`

---

## Settings Screen

Navigation: stack push, standard Android back.

### Content

**API Keys** (three separate text inputs, `secureTextEntry`)

- OpenAI API key — used for Whisper STT
- Anthropic API key — used for Claude LLM
- ElevenLabs API key — used for TTS

All validated on save (non-empty string check only — no API validation call). Stored via `expo-secure-store`.

**Persona selection** — three card options, one active at a time. Stored via `expo-secure-store` as `persona` key (`general` | `brainstorming` | `agent`).

### Personas

**General Conversation** (default)

```
You are a voice assistant. Respond naturally and concisely as if speaking out loud.
Never use markdown (no asterisks, bullets, headers, or code blocks).
Match answer length to question complexity. Ask at most one follow-up question at a time.
```

**Brainstorming**

```
You are a creative thinking partner. Explore ideas with the user, build on their thoughts,
and ask generative follow-up questions. Don't rush to conclusions — stay exploratory.
Never use markdown. Keep responses conversational and spoken-word friendly.
```

**Agent** (task management)

```
You are a task-focused assistant. When the user describes goals or problems, respond with
direct, actionable next steps. Break things down concisely. Track open items and surface
them when relevant. Never use markdown. Be efficient and direct.
```

---

## Session Storage

### Format

```typescript
interface Session {
  id: string; // UUID v4
  startedAt: string; // ISO 8601
  lastActivityAt: string; // ISO 8601, updated on every message
  messages: Message[];
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string; // ISO 8601
}
```

### Persistence

Directory: `${FileSystem.documentDirectory}sessions/`

Each session is a file: `sessions/{id}.json`

Messages are appended incrementally — after each complete exchange (user message transcribed + assistant response complete), write the full session JSON to disk. Do not buffer — write immediately so data survives crashes.

### Session Lifecycle

**Cold start:**

1. Read all session files from disk, sort by `startedAt` desc
2. Load the most recent session
3. If `lastActivityAt` is > 10 minutes ago (or no sessions exist): start a new session
4. If `lastActivityAt` ≤ 10 minutes ago: resume the session (load messages into memory)

**10-minute idle timer:**

- Reset timer on every message (user turn or assistant turn)
- When the timer fires: silently create a new session in memory (the current session is already persisted on disk)
- No notification to the user

**Double press when idle (new session trigger):**

1. Current session is already persisted (incremental writes)
2. Create a new session in memory
3. Immediately start recording

**"New Session" button on home screen:**
Same as above (double press when idle).

### Session Title

`startedAt` formatted as a human-readable timestamp: `"Apr 30, 14:23"`. No AI-generated titles.

---

## Voice Pipeline

### State Machine

```
                      ┌──────────┐
          ┌──────────▶│   idle   │◀─────────────────────┐
          │           └────┬─────┘                       │
          │                │ single press / on-screen tap │
          │                ▼                             │
          │          ┌────────────┐                      │
          │          │ recording  │                      │
          │          └─────┬──────┘                      │
          │                │ single press / tap          │
          │                ▼                             │
          │          ┌────────────┐                      │
          │          │ processing │ (Whisper in-flight)   │
          │          └─────┬──────┘                      │
          │                │ STT success                  │
          │                ▼                             │
          │          ┌────────────┐                      │
          │          │  thinking  │ (LLM stream started, │
          │          └─────┬──────┘  no TTS yet)         │
          │                │ first TTS chunk queued       │
          │                ▼                             │
          │          ┌────────────┐                      │
          │          │  speaking  │                      │
          │          └─────┬──────┘                      │
          │                │ all chunks played            │
          └────────────────┘                             │
                                                         │
    double press (if active) / barge-in ────────────────►┘
    audio focus loss ───────────────────────────────────►┘
    error ─────────────────────────────────────────────►┘
```

**Barge-in (single press while speaking/thinking/processing):**

- Cancel all pending TTS requests (AbortController)
- Stop current audio playback
- Abort LLM stream (AbortController)
- Reset state → recording (immediately start recording)

**Double press (cancel, when active):**

- Cancel all in-flight requests (AbortController)
- Stop audio playback
- Reset state → idle

### Step 1: Recording

```typescript
await Audio.requestPermissionsAsync();
const recording = await Audio.Recording.createAsync(
  Audio.RecordingOptionsPresets.HIGH_QUALITY, // m4a/AAC, accepted by Whisper
);
// store recording ref in state
```

On stop:

```typescript
await recording.stopAndUnloadAsync();
const uri = recording.getURI(); // local file URI
```

### Step 2: STT (Whisper)

POST the audio file to OpenAI's Whisper API:

```typescript
const formData = new FormData();
formData.append("file", { uri, name: "audio.m4a", type: "audio/m4a" } as any);
formData.append("model", "whisper-1");
formData.append("language", "en"); // optional, improves speed

const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
  method: "POST",
  headers: { Authorization: `Bearer ${openaiKey}` },
  body: formData,
  signal: abortController.signal,
});
const { text } = await response.json();
```

No file size check. If Whisper returns a 413 (too large), treat as an STT error and speak the error.

### Step 3: LLM (Claude Streaming)

Use `@anthropic-ai/sdk` with streaming:

```typescript
const stream = await anthropic.messages.stream({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  system: currentPersonaPrompt,
  messages: sessionMessages, // full conversation history
});
```

Conversation history format: `[{ role: 'user', content: transcript }, { role: 'assistant', content: fullResponse }, ...]`

Append user message to history before starting the LLM call. Append the full assistant response to history after the stream completes.

### Step 4: TTS Chunking

Buffer tokens from the LLM stream. Flush to ElevenLabs when:

1. A sentence-ending punctuation appears: `.`, `?`, `!`, `...` (followed by whitespace or end of buffer), or `\n\n`
2. Token count reaches 40

```typescript
let tokenBuffer = "";
let tokenCount = 0;

for await (const chunk of stream) {
  const token = chunk.delta?.text ?? "";
  tokenBuffer += token;
  tokenCount++;

  const sentenceEnd = /[.?!](\s|$)|\.{3}(\s|$)|\n\n/.test(tokenBuffer);
  if (sentenceEnd || tokenCount >= 40) {
    enqueueTTSChunk(tokenBuffer.trim());
    tokenBuffer = "";
    tokenCount = 0;
  }
}
if (tokenBuffer.trim()) {
  enqueueTTSChunk(tokenBuffer.trim());
}
```

### Step 5: TTS (ElevenLabs)

Fire TTS requests in parallel as chunks accumulate. Play in order.

```typescript
const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel

async function fetchTTSAudio(text: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": elevenLabsKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_flash_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
    signal,
  });
  // save bytes to temp file
  const arrayBuffer = await response.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  const tempUri = `${FileSystem.cacheDirectory}tts_${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(tempUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return tempUri;
}
```

### Step 6: Audio Playback Queue

Maintain an ordered queue of `Promise<string>` (temp file URIs). Start each playback when the previous finishes:

```typescript
async function playQueue(queue: Promise<string>[], signal: AbortSignal) {
  for (const uriPromise of queue) {
    if (signal.aborted) break;
    const uri = await uriPromise;
    if (signal.aborted) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      break;
    }
    const player = createAudioPlayer({ uri });
    await new Promise<void>((resolve) => {
      player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish) resolve();
      });
      player.play();
    });
    player.remove();
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}
```

On cancel/barge-in: call `abortController.abort()`. The signal propagates to all pending fetch calls and the playback loop.

---

## Error Handling

Use `expo-speech` to announce errors via Android TTS:

```typescript
import * as Speech from "expo-speech";

function speakError(message: string) {
  Speech.speak(message, { language: "en", rate: 1.0 });
}
```

Error messages (spoken, then reset to idle):

| Error                 | Message                                             |
| --------------------- | --------------------------------------------------- |
| STT failure / network | "Speech recognition failed. Please try again."      |
| LLM failure           | "AI response failed. Please try again."             |
| TTS failure           | "Audio generation failed. Please try again."        |
| No API key            | "Please add your API keys in Settings."             |
| Whisper 413           | "Recording too long. Please try a shorter message." |

After speaking the error, transition to `idle`.

---

## Permissions

On first app launch (check `expo-secure-store` for a `permissions_requested` flag):

1. Request `RECORD_AUDIO` via `Audio.requestPermissionsAsync()`
2. Request `POST_NOTIFICATIONS` via `Notifications.requestPermissionsAsync()` (needed for foreground service notification on Android 13+)
3. Set the flag so this only runs once

If `RECORD_AUDIO` is denied: show a banner on the home screen: "Microphone access required. Grant permission in device Settings."

---

## Audio Focus

Request audio focus before recording and before TTS playback. This is handled automatically by expo-audio when you configure the audio mode:

```typescript
await Audio.setAudioModeAsync({
  allowsRecordingIOS: false,
  interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
  shouldDuckAndroid: false,
  playThroughEarpieceAndroid: false,
});
```

On `AUDIOFOCUS_LOSS` (phone call, other audio app takes focus): expo-audio will pause playback automatically. The app must detect the interruption and reset to idle. Listen for audio interruption events from expo-audio and reset the pipeline state.

---

## Headphone Button Native Module

### Location

`modules/headphone-button/`

Create with: `npx create-expo-module --local headphone-button`

### Kotlin Implementation

`modules/headphone-button/android/src/main/java/expo/modules/headphonebutton/`

**HeadphoneButtonModule.kt** — Expo Module that:

1. Starts/stops a `HeadphoneButtonService` (ForegroundService)
2. Exposes `startListening()` and `stopListening()` to JS
3. Emits `onButtonEvent` events to JS with `{ type: 'single' | 'double' }`

**HeadphoneButtonService.kt** — ForegroundService that:

1. Creates a `MediaSession` and sets it active
2. Implements `MediaSession.Callback.onMediaButtonEvent()`
3. Applies 300ms debounce to classify presses as single or double
4. Sends classified events back to the module via a local broadcast or direct reference

### Debounce Logic (Kotlin)

```kotlin
private var pressCount = 0
private val handler = Handler(Looper.getMainLooper())
private val debounceRunnable = Runnable {
    val type = if (pressCount >= 2) "double" else "single"
    emitEvent(type)
    pressCount = 0
}

fun onButtonPress() {
    pressCount++
    handler.removeCallbacks(debounceRunnable)
    handler.postDelayed(debounceRunnable, 300)
}
```

### JS Interface

```typescript
import HeadphoneButtonModule from "../modules/headphone-button";

HeadphoneButtonModule.startListening();

const subscription = HeadphoneButtonModule.addListener("onButtonEvent", (event) => {
  if (event.type === "single") handleSinglePress();
  if (event.type === "double") handleDoublePress();
});

// cleanup
HeadphoneButtonModule.stopListening();
subscription.remove();
```

### Service Lifecycle

- Start service: when app enters foreground (`AppState` change to `'active'`)
- Stop service: when app enters background (`AppState` change to `'background'` or `'inactive'`)
- Notification: `"Yunto is running"` (minimal, no action buttons, tap opens app)

---

## Session List Screen

### Layout

- Standard FlatList, newest session first
- Each row:
  - Left: formatted timestamp (e.g. `"Apr 30, 14:23"`)
  - Right: message count (e.g. `"6 messages"`)
- Tap → push `SessionDetailScreen`
- No delete in MVP

### Session Detail Screen

- Title: session timestamp
- ScrollView of messages, alternating user/assistant
- User messages: right-aligned, distinct background
- Assistant messages: left-aligned
- Each message shows its timestamp in small text
- "Copy All" button at top-right: formats full transcript as plain text, copies to clipboard

---

## Double Press Behavior (Summary)

| Current state | Double press result                                        |
| ------------- | ---------------------------------------------------------- |
| `recording`   | Cancel recording, discard audio → `idle`                   |
| `processing`  | Abort Whisper request → `idle`                             |
| `thinking`    | Abort LLM stream + TTS → `idle`                            |
| `speaking`    | Abort TTS queue + stop playback → `idle`                   |
| `idle`        | Save session → new session → start recording → `recording` |

---

## Implementation Order

Build in this sequence. Each step should be testable before proceeding.

1. **Navigation + screen scaffolding** — set up React Navigation stack, create empty screen components for Home, Settings, SessionList, SessionDetail
2. **Settings screen** — API key inputs with expo-secure-store, persona cards
3. **Session storage layer** — `SessionStore` module: create, load, append message, list sessions (expo-file-system)
4. **STT integration** — record with expo-audio, POST to Whisper, return transcript. Test with a hardcoded audio file first.
5. **LLM integration** — stream from Claude with `@anthropic-ai/sdk`. Test the streaming pipeline in isolation (log tokens to console).
6. **TTS integration** — ElevenLabs REST per chunk, save to temp file, play with expo-audio. Test with a hardcoded string.
7. **Pipeline state machine** — wire STT → LLM → TTS chunking → playback queue. Add AbortController for cancel/barge-in. Test end-to-end with on-screen button.
8. **Home screen UI** — waveform animation, state-driven status text, empty state, on-screen tap target
9. **Session list + detail screens** — SessionListScreen (FlatList), SessionDetailScreen (transcript + copy)
10. **Session lifecycle** — idle timer, cold-start logic, double-press-when-idle new session flow
11. **Headphone button native module** — Kotlin Expo Module + ForegroundService + MediaSession. Wire events to the pipeline state machine.
12. **Permissions + first-run flow** — RECORD_AUDIO + POST_NOTIFICATIONS request on first launch
13. **Error handling** — expo-speech error announcements for each failure mode
14. **Audio focus** — handle interruptions (phone calls), configure audio mode

---

## File Structure (Target)

```
src/
  screens/
    HomeScreen.tsx
    SettingsScreen.tsx
    SessionListScreen.tsx
    SessionDetailScreen.tsx
  components/
    WaveformAnimation.tsx
  services/
    stt.ts           # Whisper API
    llm.ts           # Claude streaming
    tts.ts           # ElevenLabs REST
    pipeline.ts      # State machine + orchestration
    sessionStore.ts  # Session persistence
    settingsStore.ts # expo-secure-store wrappers
  navigation/
    AppNavigator.tsx
  constants/
    personas.ts      # System prompt strings
modules/
  headphone-button/  # Expo local module (Kotlin)
App.tsx
```

---

## Out of Scope (v2)

- Session summaries, open questions, action items
- Silence detection / auto-stop
- Multiple LLM providers (GPT-4, Gemini)
- ElevenLabs streaming WebSocket
- Voice selection
- Model routing / presets
- Export to markdown
- "Continue in Claude/ChatGPT" clipboard export
- Context window management / summarization
- Android Doze / battery optimization guidance
- Tool use / web search (see below)

---

## Tool Use

Claude can call tools during a conversation, allowing the Agent persona to answer factual questions, perform arithmetic, and report the current time without hallucinating.

### Decisions

| Decision | Choice |
| -------- | ------ |
| Tools | `search_wikipedia`, `get_datetime`, `calculate` (all free, no extra API keys) |
| Persona scope | Agent persona only |
| Spoken hint | `expo-speech` speaks `"Searching"` immediately when any tool is called |
| Tool result persistence | Not persisted — tool call messages exist only for the duration of the LLM turn |
| Math parser | `expr-eval` (safe, no `eval()`) |

### New pipeline state

```
idle → recording → processing → thinking
  → (searching)*   ← 0–N tool call rounds
  → speaking → idle
```

The `searching` state replaces `thinking` during tool execution. Same waveform pulse animation. UI label: `"Searching..."`.

### Tools

| Tool | Description | Implementation |
| ---- | ----------- | -------------- |
| `search_wikipedia` | Factual look-ups: people, places, concepts, history | Wikipedia REST API (free) — search endpoint → summary endpoint, first ~300 chars of extract |
| `get_datetime` | Current local date and time | `new Date().toLocaleString()` — no network |
| `calculate` | Math expressions: `+`, `-`, `*`, `/`, `**`, `sqrt`, parentheses | `expr-eval` package |

Claude is instructed to prefer answering directly and only call tools when the question requires specific facts or arithmetic.

### Spoken acknowledgement

When a tool call is detected, `expo-speech` immediately speaks `"Searching"` before the tool request is in flight. This fills the silence and makes the behaviour transparent to the user.

### Multi-turn loop

The LLM service handles tool call rounds internally. The pipeline consumer (`streamWithTools` async generator) behaves identically to `streamResponse` from the caller's perspective — it yields text tokens. Tool call messages (the `tool_use` assistant block and `tool_result` user block) are only kept in an in-flight local array and are never written to the session store.

### Implementation files

| File | Change |
| ---- | ------ |
| `src/services/tools.ts` | New — tool definitions (`TOOL_DEFINITIONS`) and `executeTool(name, input, signal)` dispatch |
| `src/services/llm.ts` | Add `streamWithTools()` alongside unchanged `streamResponse()` |
| `src/services/pipeline.ts` | Use `streamWithTools` when Agent persona active; add `"searching"` to `PipelineStatus` |
| `src/constants/personas.ts` | Update Agent system prompt to mention available tools |
| `src/screens/HomeScreen.tsx` | Add `"searching": "Searching..."` to status label map |

### Agent system prompt

```
You are a task-focused assistant with access to tools: Wikipedia search, current date/time, and a calculator. Use tools when a question requires specific facts, current time, or arithmetic. For everything else, answer directly without calling tools. Keep spoken responses short. Never use markdown. Always reply in the same language the user speaks.
```

### Error handling

If a tool call fails (network error, no result): return an error string as the `tool_result` content. Claude will acknowledge it can't retrieve the information and answer from training data. Same `speakError` path for hard failures.

### Future extensions

- Web search via a BYOK search API (e.g. Brave Search) for current events and news
- More tools: weather, unit conversion, news headlines
- Tools available for General / Brainstorming personas
- Locale-aware spoken hint
