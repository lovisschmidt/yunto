# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Yunto is a voice-first AI companion app for Android built with React Native (TypeScript) using the **Expo bare workflow**. Users bring their own API keys (BYOK) — no backend, no server. The app is distributed as an APK via GitHub Releases (no Play Store).

Package manager: **npm**. When adding Expo native modules, always use `npx expo install <package>` instead of `npm install` — it resolves the SDK-compatible version. Plain `npm install` will pull the latest release which may target a newer SDK and cause a native crash at startup (`NoClassDefFoundError` in `expo-modules-core`).

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

## Releases & versioning

The app ships as a signed APK via GitHub Releases, built automatically by `.github/workflows/ci.yml` on every push to `main` (after the `check` job passes). Releases are keyed off **`version` in `package.json`** — it becomes the `versionName` and the release tag `v{version}`.

- **Bump `package.json` `version` (semver) in any PR whose changes should ship to users.** When the PR squash-merges to `main`, CI builds and publishes Release `v{version}` containing everything merged since the last tagged release.
- If `version` is **not** bumped, the merge still lands but **no release is created** — CI sees tag `v{version}` already exists and skips silently. So shipping is opt-in per PR: code/feature PRs that users should receive must bump; docs/CI-only changes need not (and shouldn't).
- `versionCode` is set automatically from the CI run number (`-PversionCode=${{ github.run_number }}`) — never edit it by hand.

See `docs/specs/2026-05-21-release-pipeline.md` for the full design.

## Architecture

### Core pipeline

The central feature is a low-latency streaming pipeline:

```
Headphone button press / on-screen tap
  → start audio recording (Bluetooth headset mic if connected, else phone mic)
Second press / tap
  → stop recording → Whisper STT (OpenAI REST)
  → STT result → start Claude stream (Anthropic, streaming)
  → as LLM tokens arrive → feed them to a streaming ElevenLabs TTS WebSocket
  → native Android AudioTrack plays PCM gaplessly, starting before the LLM finishes
```

Perceived latency is dominated by STT round-trip + time-to-first-token. TTS playback starts mid-generation — this is intentional and critical to the natural feel.

The pipeline lives in `src/services/pipeline.ts` (`usePipeline` hook), wiring `stt.ts` → `llm.ts` (`streamWithTools`) → `ttsStream.ts` (WebSocket) → the native PCM player.

### Headphone button capture

The only part requiring native Android code, implemented as an **Expo Module** (Expo Modules API in Kotlin). Requires:

- A **Foreground Service** running continuously in the background
- An active **MediaSession** to receive hardware button events

Android grants button priority to the last app that held an active MediaSession — so Yunto only captures the button when no music app is active. This is the intended behavior, not a limitation. Some manufacturers (Samsung, Xiaomi) apply aggressive battery optimization; users must manually exempt the app.

The same native module also owns **Bluetooth headset mic capture** (classic HFP/SCO) and **TTS playback** (a streaming `AudioTrack` PCM player). When a BT headset mic is connected the pipeline records through it and tears SCO down before playback so replies play in hi-fi A2DP, falling back to the phone mic if SCO can't link. See `docs/specs/2026-06-04-bluetooth-mic.md` and `docs/specs/2026-06-03-tts-streaming.md`.

### LLM provider

Today the app uses **Claude only** (`claude-sonnet-4-6`, Anthropic), fixed per build. The README/spec mention of a multi-provider model router (GPT, Gemini) is **roadmap, not implemented** — don't assume a router or provider selection exists. The user supplies three keys (OpenAI for STT, Anthropic for LLM, ElevenLabs for TTS), stored locally via `expo-secure-store`.

### Data model

Everything is local (JSON). No network calls except to the three external APIs (STT, LLM, TTS). A session is just **conversation history (messages array) + timestamps** (`id`, `startedAt`, `lastActivityAt`, `messages`). LLM-generated summaries / open questions / action items and model selection are roadmap items — **not** part of the stored session today.

### Explicit stop, never silence-stop

A turn ends only on a deliberate action (button press or on-screen tap). There is **no VAD / auto-silence timer** — this is a core product decision so users can pause to think mid-utterance without being cut off. Do not add silence/timeout auto-stop.

The one nuance: in Bluetooth mode the headset button can't reach the app during a call, so a deliberate **in-headset mute** — detected as true digital silence (~-160 dBFS on the SCO uplink) — is treated as the stop. That is mute detection, not silence/VAD auto-stop; a live mic floors well above the threshold even during pauses.

## Conventions

- **Commits**: commitlint standard — `type(scope): subject` (lowercase, imperative, no trailing period)
- **Language**: TypeScript throughout; strict mode
- **Linting / formatting**: oxlint + oxfmt — no ESLint, no Prettier
- **Imports**: use `.js` extensions on relative imports (ESM style). `expo/tsconfig.base` sets `moduleResolution: "bundler"` which satisfies TypeScript. Metro doesn't natively map `.js` → `.ts` when a custom `resolveRequest` is set, so `metro.config.js` strips the `.js` suffix before passing to oxc-resolver (which then probes `.ts`/`.tsx`). Do not switch to `node16`/`nodenext` module resolution; it conflicts with Metro.
- **Native code**: confined to the headphone button Expo module (button capture, Bluetooth SCO control, and the `AudioTrack` PCM player) — everything else is JS/TS. Use Expo Modules API (Kotlin) for any future native additions.
- **Specs & docs**: implementation specs are point-in-time ADR-style snapshots in `docs/specs/` (`YYYY-MM-DD-<slug>.md` with a status header); index at `docs/specs/README.md`. When scoping a feature, write the spec there and open a draft PR outlining the implementation. Specs are not edited after merge — a newer spec supersedes the relevant parts. Current behavior lives in code, this file, and `README.md`, not the specs.
