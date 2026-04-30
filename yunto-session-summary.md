# Yunto — Project Summary

## Concept

**Yunto** is a voice-first AI companion app for Android (React Native) that enables hands-free conversation with LLMs — primarily designed for use on the go, e.g. while cycling or walking. The name derives from "junto" (Spanish/Latin for "together").

---

## The Problem

Existing voice modes (Claude, Gemini Live, ChatGPT) don't fully solve the problem:

- Always locked to one model (no LLM agnosticism)
- No true hands-free operation (Send button required, screen dependency)
- Pause detection cuts off mid-thought
- Voice is an add-on feature, not the primary interaction mode

**Why this gap exists:**

- Google has a structural conflict of interest: a good AI companion that knows your thoughts would be the most powerful ad-targeting tool ever — which is exactly why users won't trust it
- Apple is hardware- and ecosystem-first: a truly good LLM assistant would require letting third-party models (Claude, GPT) into their ecosystem, which contradicts their control philosophy
- Anthropic and OpenAI want you to use their model — so they build voice as a feature in their own app, not as an open interface
- LLM quality has only become good enough for real conversation in 2024/2025 — the market is just now ready

---

## The Solution

### Core MVP Features

- **Headphone button trigger**: One press starts recording, second press ends and sends (push-to-talk). No timeout tuning, fully deterministic.
- **True hands-free operation**: Foreground Service with MediaSession on Android — persistent notification (like Wispr/Spotify). Only captures the button when no other app (e.g. Spotify) is active — Android manages priority automatically via last-active principle.
- **LLM agnosticism**: User selects model (Claude, GPT-4, Gemini). Model router with presets possible ("quick answer", "deep conversation").
- **BYOK (Bring Your Own Key)**: User brings their own API keys. No backend infrastructure, zero running costs for the developer.
- **Streaming STT → LLM → TTS**: First TTS output begins before the LLM finishes generating — critical for a natural feel.
- **Session memory**: Conversation history maintained within a session.

### STT

- **Whisper API** (OpenAI): $0.006/min — ~$5.40/month at 15h usage. Primary option.
- **Android built-in STT**: Free, lower quality, available as fallback.
- Wispr Flow has no public API → integration not possible.

### TTS

- **ElevenLabs**: Starter plan $5/month, 30k credits — sufficient for personal use. Flash model with ~75ms latency for real-time output.
- Alternative: Google Cloud TTS (cheaper, but lower quality).

### Why Wispr Feels Better (and What That Teaches Us)

Wispr runs a second LLM pass after transcription: removes filler words, smooths structure, resolves backtracking. For voice conversation this isn't strictly necessary — but an optional cleanup pass before the LLM query (via system prompt or separate call) would be a differentiating feature.

---

## Technical Stack

| Component        | Decision                             | Reason                                                 |
| ---------------- | ------------------------------------ | ------------------------------------------------------ |
| Framework        | React Native (TypeScript)            | Developer knows RN + TS, cross-platform possible later |
| STT              | Whisper API                          | Quality, price, stable API                             |
| TTS              | ElevenLabs Flash                     | Latency, quality                                       |
| LLM              | Claude / GPT-4 / Gemini (selectable) | BYOK, LLM-agnostic                                     |
| Headphone button | Native Module (MediaSession)         | Only part requiring native Android code                |
| Data persistence | Local (JSON)                         | No backend required                                    |

### Critical Technical Details

- **Headphone button**: Foreground Service + active MediaSession required. Works as long as no other music app is active. Some manufacturers (Samsung, Xiaomi) have aggressive battery optimization → users need to manually exempt the app.
- **Latency pipeline**: STT result → start LLM stream → play first TTS chunks before LLM finishes. This makes the biggest difference in perceived quality.
- **Silence detection as optional mode**: Configurable timeout (e.g. 2–5 seconds) for situations where push-to-talk isn't possible (e.g. cycling with gloves).

---

## Open Source Strategy

- **License**: MIT
- **Hosting**: GitHub, public repository
- **Distribution**: APK via GitHub Releases (no Play Store needed for MVP)
- **Zero running costs** for the developer: no backend, no server, BYOK
- **Positioning**: Portfolio project + quality signal, not a commercial product
- Key files: `README.md` (problem, demo, setup, architecture), `CONTRIBUTING.md`, `LICENSE`, structured issues with `good first issue` labels

### Commercial Path (Optional, Later)

The open source approach is a valid sequencing strategy — not the only option. A commercial service with a hosted backend, managed LLM costs, and persistent memory across sessions is a fully viable business model at ~$20–25/month per user. Open source first validates the core experience and builds distribution before adding commercial infrastructure.

---

## Workflow Integration (Killer Feature)

At the end of each session, the LLM automatically generates:

- Compact summary (200–400 words)
- Open questions
- Action items

### Export Options

- **"Continue in Claude/ChatGPT"**: App copies a prepared context prompt to clipboard → user opens web UI, pastes, continues seamlessly
- **Markdown export**: Save session as a file

### UX Pattern

> Yunto is the **capture layer**, the web UI is the **deep work layer**, the LLM-generated summary is the **bridge** between the two.

---

## Estimated Effort (MVP)

| Part                                                                 | Effort                  |
| -------------------------------------------------------------------- | ----------------------- |
| RN setup, project structure, settings screen, LLM integration (text) | ~8h                     |
| Audio pipeline (STT → LLM streaming → TTS)                           | ~10–15h                 |
| Headphone button native module                                       | ~3h                     |
| Model router, README, GitHub setup                                   | ~3–5h                   |
| **Total**                                                            | **~25h (2–3 weekends)** |

---

## End User Cost Estimate (30min/day usage)

| Service                  | Cost/month         |
| ------------------------ | ------------------ |
| Whisper STT              | ~$5                |
| ElevenLabs TTS           | ~$5 (Starter plan) |
| LLM (e.g. Claude Sonnet) | ~$3–5              |
| **Total**                | **~$13–15/month**  |

All costs borne by the user via their own API keys. Developer running cost: $0.

---

## Market Context

- a16z explicitly stated in early 2025 that voice will be the primary consumer AI interaction mode — as an always-available companion or coach
- Limitless (AI pendant for passive recording) was acquired by Meta in December 2025 — validates the market, but solved a different problem (passive recording vs. active conversation)
- The window for an independent, open, model-agnostic voice companion is open — but won't stay open indefinitely as the big players improve their voice modes

---

## Open Questions / Next Steps

- [x] Project name: **Yunto**
- [x] Create GitHub repository (MIT license): `github.com/<user>/yunto`
- [ ] README-first: write out concept as README before writing code
- [ ] Prepare `CLAUDE.md` / context files for agentic coding
- [ ] Evaluate optional LLM cleanup pass for voice input
- [ ] Evaluate ElevenLabs vs. Google Cloud TTS for this specific use case
