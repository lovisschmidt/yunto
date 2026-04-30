# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Yunto is a voice-first AI companion app for Android built with React Native (TypeScript) using the **Expo bare workflow**. Users bring their own API keys (BYOK) — no backend, no server. The app is distributed as an APK via GitHub Releases (no Play Store).

Package manager: **npm**.

## Commands

```bash
# Development
npm start               # Metro bundler (Expo CLI)
npm run android         # Build and run on device/emulator

# Quality
npm run lint            # oxlint
npm run lint:fix        # oxlint --fix
npm run fmt             # oxfmt (format in place)
npm run fmt:check       # oxfmt --check (CI)
npm run typecheck       # tsc --noEmit
npm test                # Jest
npm test -- --testPathPattern=<file>  # single test file
```

## Architecture

### Core pipeline

The central feature is a low-latency streaming pipeline:

```
Headphone button press
  → start audio recording (Whisper API or Android STT)
Second press
  → stop recording → send audio to STT
  → STT result → start LLM stream (Claude / GPT-4 / Gemini)
  → as LLM tokens arrive → enqueue TTS chunks (ElevenLabs Flash)
  → begin audio playback before LLM finishes
```

Perceived latency is dominated by STT round-trip + time-to-first-token. TTS playback starts mid-generation — this is intentional and critical to the natural feel.

### Headphone button capture

The only part requiring native Android code, implemented as an **Expo Module** (Expo Modules API in Kotlin). Requires:

- A **Foreground Service** running continuously in the background
- An active **MediaSession** to receive hardware button events

Android grants button priority to the last app that held an active MediaSession — so Yunto only captures the button when no music app is active. This is the intended behavior, not a limitation. Some manufacturers (Samsung, Xiaomi) apply aggressive battery optimization; users must manually exempt the app.

### LLM routing

The app supports multiple LLM providers behind a model router. Each provider is configured with the user's own API key stored locally. A session uses one model; switching models starts a new session.

### Data model

Everything is local (JSON). No network calls except to the three external APIs (STT, LLM, TTS). A session holds:

- Conversation history (messages array)
- Model/provider selection
- LLM-generated summary, open questions, and action items (generated at session end)

### Silence detection mode

Optional alternative to push-to-talk: configurable auto-stop timeout (2–5 seconds of silence). Used when push-to-talk isn't practical (cycling with gloves). Push-to-talk is the default and preferred mode.

## Conventions

- **Commits**: commitlint standard — `type(scope): subject` (lowercase, imperative, no trailing period)
- **Language**: TypeScript throughout; strict mode
- **Linting / formatting**: oxlint + oxfmt — no ESLint, no Prettier
- **Imports**: use `.js` extensions on relative imports (ESM style). No tsconfig change needed — `expo/tsconfig.base` already sets `moduleResolution: "bundler"` which resolves `.js` to `.ts` files. Do not switch to `node16`/`nodenext` module resolution; it conflicts with Metro.
- **Native code**: confined to the headphone button Expo module — everything else is JS/TS. Use Expo Modules API (Kotlin) for any future native additions.
