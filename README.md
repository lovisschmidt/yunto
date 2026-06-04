<p align="center">
  <!-- Drop your teaser image at docs/teaser.png (the same one you use as the GitHub social image). -->
  <img src="docs/teaser.png" alt="Yunto — voice-first AI companion for Android" width="100%">
</p>

# Yunto

**A voice-first AI companion for Android. Hands-free, bring your own keys.**

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/lovisschmidt/yunto?label=Download%20APK&style=for-the-badge&logo=android&logoColor=white&color=3DDC84" alt="Download the latest APK"></a>
  <img src="https://img.shields.io/badge/platform-Android-3DDC84?style=for-the-badge&logo=android&logoColor=white" alt="Platform: Android">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/lovisschmidt/yunto?style=for-the-badge&color=blue" alt="MIT License"></a>
</p>

Yunto lets you have real conversations with an LLM while on the go — cycling, walking, commuting — without touching your phone. One headphone button press starts recording, a second press sends. That's it.

> **Status:** Working prototype, shipping as an APK via [GitHub Releases](../../releases). Android only, distributed outside the Play Store. See [Shipped today](#shipped-today) for what's actually in the build and [Roadmap](#roadmap) for what isn't yet.

---

## The Problem

Every major voice mode (Claude, Gemini Live, ChatGPT) has the same structural limitations:

- **Locked to one model** — no way to choose Claude vs. GPT vs. Gemini per task
- **Not truly hands-free** — requires tapping a Send button or unlocking your screen
- **Pause detection fails mid-thought** — auto-silence timers cut off anyone who thinks out loud
- **Voice is an afterthought** — bolted onto a chat interface, not built as the primary mode

This gap exists for structural reasons: Google's ad model creates a trust problem, Apple's ecosystem control prevents letting third-party models in, and Anthropic/OpenAI want you using their app specifically. Nobody has an incentive to build an open, model-agnostic voice layer.

---

## The Solution

Yunto is a **capture layer**: a lightweight, always-accessible voice interface that hands off to an LLM and stays out of your way. No backend, no account — you bring your own API keys and everything stays on your device.

### Core principles

- **Explicit stop, never silence-stop.** A turn ends on a deliberate action (button press or on-screen tap), so you can take long thinking pauses without being cut off. There is no VAD/auto-silence timer. This is a product decision, not a missing feature.
- **Bring your own keys.** You provide API keys for the three services Yunto talks to. There is no server and zero running cost for the developer.
- **Local-first.** Conversations are stored as plain JSON on the device. The only network calls are to the three external APIs (STT, LLM, TTS).

---

## Shipped today

What's in the current build:

**Headphone button trigger**
One press starts recording, a second press ends and sends. Push-to-talk — fully deterministic, no timeout tuning. An Android Foreground Service with an active MediaSession intercepts the button. Yunto only captures it when no other audio app (e.g. Spotify) holds MediaSession priority — Android's last-active rule manages this automatically. On-screen tap does the same thing as a single press.

**Bluetooth headset mic capture**
When a classic-BT headset with a mic is connected, Yunto records through it (HFP/SCO) instead of the pocketed phone mic, then tears SCO down so the reply plays back in hi-fi A2DP. If SCO can't connect within ~3s it falls back to the phone mic with a spoken cue and a badge. Because the headset firmware owns the button during a call, the in-headset mute gesture is detected (true digital silence on the uplink) as the stop signal in BT mode. A home-screen badge shows which mic is active. (LE Audio is on the roadmap.)

**Streaming pipeline**
Whisper STT → Claude stream → ElevenLabs streaming TTS, played gaplessly. Audio starts playing while the model is still generating — first speech comes within a second or two of sending, which is what makes the interaction feel natural. TTS streams over a WebSocket into a native Android `AudioTrack` (no inter-sentence gaps).

**Personas**
Three selectable conversation styles, set in Settings: **General Conversation** (default), **Brainstorming**, and **Agent** (task-focused). Each is a tuned system prompt.

**Tools**
The model can call tools during a conversation when a question needs a hard fact or a calculation: **Wikipedia search**, **current date/time**, and a **calculator**. All free, no extra keys. When a tool fires before any audio has started, Yunto speaks a short "Searching" cue.

**Adjustable playback speed**
TTS playback speed is configurable from 0.5× to 2×.

**Sessions**
Conversation history is kept within a session and persisted locally as JSON. A new session starts fresh; an idle session rolls over after 10 minutes. Browse past sessions in a list, open one to read the transcript, and use **Copy All** to copy the full transcript to the clipboard.

**Spoken errors**
Failures (bad key, network, etc.) are announced via Android TTS, then the app returns to idle.

---

## Roadmap

Designed for, but not yet built:

- **Multiple LLM providers** — GPT and Gemini behind a model router, with optional presets ("quick answer", "deep conversation"). Today the LLM is **Claude only**.
- **Session workflow integration** — an LLM-generated end-of-session summary, open questions, and action items; "Continue in Claude/ChatGPT" clipboard export; Markdown export. Today sessions support transcript copy only.
- **LE Audio mic** — wideband LC3 capture with simultaneous hi-fi output (no SCO teardown, and likely frees the headset button).
- **More tools** — weather, unit conversion, BYOK web search for current events.

---

## Technical Stack

| Component                 | Decision                                                                    | Reason                                              |
| ------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------- |
| Framework                 | React Native (TypeScript), Expo bare workflow                               | Developer-familiar; native escape hatch when needed |
| STT                       | OpenAI Whisper (REST)                                                       | Quality, price (~$0.006/min), stable API            |
| LLM                       | Claude (Anthropic), streaming                                               | Single provider today; router planned               |
| TTS                       | ElevenLabs Flash, streaming over WebSocket                                  | ~75ms model latency; gapless native playback        |
| Headphone button + BT mic | Native Expo Module (Kotlin) — MediaSession, Foreground Service, SCO control | The only part requiring native Android code         |
| Audio playback            | Native Android `AudioTrack` (PCM stream)                                    | Gapless streaming TTS                               |
| Key storage               | expo-secure-store                                                           | Keys never leave the device                         |
| Data persistence          | Local JSON (expo-file-system)                                               | No backend required                                 |

**Android-specific notes:**

- Foreground Service + active MediaSession are required for background button capture.
- Bluetooth mic capture is classic HFP/SCO and needs Android 12+ (API 31) for the modern routing path; below API 29 it falls back to the phone mic.
- Some manufacturers (Samsung, Xiaomi) use aggressive battery optimization — users may need to manually exempt the app.
- Push-to-talk works as long as no other music app holds MediaSession priority.

---

## User Cost Estimate

Based on ~30 minutes of active voice use per day, paid via your own API keys:

| Service                       | Cost/month        |
| ----------------------------- | ----------------- |
| Whisper STT (OpenAI)          | ~$5               |
| ElevenLabs TTS (Starter plan) | ~$5               |
| LLM — e.g. Claude Sonnet      | ~$3–5             |
| **Total**                     | **~$13–15/month** |

Developer running cost: $0.

---

## Setup

**Prerequisites:**

- An Android device (API 26+; Bluetooth mic needs API 31+)
- Three API keys, entered in **Settings** on first run:
  - **OpenAI** — Whisper STT
  - **Anthropic** — Claude LLM
  - **ElevenLabs** — TTS

**Download the APK** from [Releases](../../releases) and sideload it. The release build (`com.yunto.app`) and a debug build (`com.yunto.app.debug`, labelled "Yunto Dev") can coexist on the same device.

**Build from source:**

```bash
nvm use            # Node 24 (see .nvmrc)
npm install
npm run android    # build and run on a connected device/emulator
```

Other useful commands:

```bash
npm start          # Metro bundler
npm run lint       # oxlint
npm run typecheck  # tsc --noEmit
npm test           # Jest
```

See [`CLAUDE.md`](CLAUDE.md) for project conventions and [`docs/specs/`](docs/specs/) for the implementation specs.

---

## Contributing

Contributions welcome. If you're working on something substantial, open an issue first to align on direction. Implementation history and design decisions live as point-in-time specs under [`docs/specs/`](docs/specs/).

---

## Support

Yunto is free and has no running cost for me — you bring your own keys. If it's useful to you and you'd like to support continued development, you can [buy me a coffee](https://buymeacoffee.com/lovisschmidt) or [tip on Ko-fi](https://ko-fi.com/lovisschmidt). Entirely optional.

<a href="https://buymeacoffee.com/lovisschmidt"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy me a coffee"></a>
<a href="https://ko-fi.com/lovisschmidt"><img src="https://img.shields.io/badge/Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-fi"></a>

---

## License

MIT — see [LICENSE](LICENSE).
