# Yunto

**A voice-first AI companion for Android. Hands-free, model-agnostic, bring your own keys.**

Yunto lets you have real conversations with LLMs while on the go — cycling, walking, commuting — without touching your phone. One headphone button press starts recording, a second press sends. That's it.

---

## The Problem

Every major voice mode (Claude, Gemini Live, ChatGPT) has the same structural limitations:

- **Locked to one model** — no way to choose Claude vs. GPT vs. Gemini per task
- **Not truly hands-free** — requires tapping a Send button or unlocking your screen
- **Pause detection fails mid-thought** — auto-silence timers cut off anyone who thinks out loud
- **Voice is an afterthought** — bolted onto a chat interface, not built as the primary mode

This gap exists for structural reasons: Google's ad model creates a trust problem, Apple's ecosystem control prevents letting third-party models in, and Anthropic/OpenAI want you using their app specifically. Nobody has an incentive to build an open, model-agnostic voice layer.

LLM quality only became good enough for real conversation in 2024/2025. The market is just now ready.

---

## The Solution

Yunto is a **capture layer**: a lightweight, always-accessible voice interface that hands off to the LLM of your choice and bridges back to deeper work when needed.

### Core Features (MVP)

**Headphone button trigger**
One press starts recording, second press ends and sends. Push-to-talk — fully deterministic, no timeout tuning. Android Foreground Service with MediaSession handles the button interception. Only captures it when no other audio app (e.g. Spotify) is active — Android's last-active priority manages this automatically.

**LLM agnosticism**
Choose Claude, GPT-4, or Gemini per session. Model router with optional presets ("quick answer", "deep conversation") planned for later.

**BYOK — Bring Your Own Key**
Users provide their own API keys for OpenAI (STT + optionally LLM), Anthropic, Google, and ElevenLabs. No backend, no server, zero running cost for the developer.

**Streaming pipeline**
STT result → start LLM stream → begin TTS playback before LLM finishes generating. The first audio plays while the model is still thinking. This is what makes the interaction feel natural.

**Session memory**
Conversation history is maintained within a session. A new session starts fresh.

**Silence detection (optional)**
Configurable timeout (2–5 seconds) for situations where push-to-talk isn't possible (cycling with gloves, driving).

---

## Workflow Integration

At the end of each session, the LLM automatically generates:

- A compact summary (200–400 words)
- Open questions
- Action items

**Export options:**
- **"Continue in Claude/ChatGPT"**: Copies a prepared context prompt to clipboard — open the web UI, paste, continue seamlessly
- **Markdown export**: Save the session as a file

> Yunto is the **capture layer**, the web UI is the **deep work layer**, the LLM-generated summary is the **bridge** between the two.

---

## Technical Stack

| Component | Decision | Reason |
|---|---|---|
| Framework | React Native (TypeScript) | Developer-familiar, cross-platform possible later |
| STT | Whisper API (OpenAI) | Quality, price ($0.006/min), stable API |
| TTS | ElevenLabs Flash | ~75ms latency, quality |
| LLM | Claude / GPT-4 / Gemini (selectable) | BYOK, model-agnostic |
| Headphone button | Native Module (Android MediaSession) | Only part requiring native Android code |
| Data persistence | Local (JSON) | No backend required |

**Latency pipeline detail:** STT result arrives → LLM stream starts immediately → first TTS chunks are enqueued before LLM finishes → audio begins playing within ~1–2 seconds of sending. This is the biggest driver of perceived quality.

**Android-specific notes:**
- Foreground Service + active MediaSession required for background button capture
- Some manufacturers (Samsung, Xiaomi) use aggressive battery optimization — users may need to manually exempt the app
- Push-to-talk works as long as no other music app holds MediaSession priority

---

## User Cost Estimate

Based on ~30 minutes of active voice use per day:

| Service | Cost/month |
|---|---|
| Whisper STT (OpenAI) | ~$5 |
| ElevenLabs TTS (Starter plan) | ~$5 |
| LLM — e.g. Claude Sonnet | ~$3–5 |
| **Total** | **~$13–15/month** |

All costs are borne by the user via their own API keys. Developer running cost: $0.

---

## Setup

> Work in progress — instructions will be added as the app is built.

**Prerequisites:**
- Android device (API 26+)
- API keys: OpenAI (STT), one LLM provider (Anthropic / OpenAI / Google), ElevenLabs (TTS)

**Build from source:**

```bash
# coming soon
```

**Or download the APK** from [Releases](../../releases) and sideload it.

---

## Status

This project is in early development. The architecture and feature set are defined; implementation has not started yet.

Planned build order:
1. RN project setup, settings screen, LLM text integration
2. Audio pipeline (STT → LLM streaming → TTS)
3. Headphone button native module
4. Model router, session summary, export

Estimated effort: ~25 hours across 2–3 weekends.

---

## Contributing

Contributions welcome. Issues labeled [`good first issue`](../../issues?q=is%3Aopen+label%3A%22good+first+issue%22) are a good starting point.

If you're working on something substantial, open an issue first to align on direction.

---

## License

MIT — see [LICENSE](LICENSE).
