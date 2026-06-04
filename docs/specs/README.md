# Specs

Implementation specs for Yunto, kept as **point-in-time snapshots**. Each spec is the plan
as it was written before (or alongside) the PR that implemented it — an ADR-style record, not a
living document. Once merged, a spec is not edited to track later changes; instead a newer spec
**supersedes** the relevant parts, and the older one's header points forward.

So: to understand _why_ something was built a certain way, read the spec. To understand _how the
app behaves today_, read the code, [`../../README.md`](../../README.md), and
[`../../CLAUDE.md`](../../CLAUDE.md).

## Conventions

- **Location:** `docs/specs/`
- **Filename:** `YYYY-MM-DD-<slug>.md`, dated when the spec was created. The date prefix makes
  reading order explicit and signals these are snapshots.
- **Header:** every spec starts with a status block — `Status` (implementing PR), `Created`
  date, and any `Supersedes` / `Superseded by` links.
- **Workflow:** write the spec → open a draft PR outlining the implementation → build → squash-merge.

## Index

| Date       | Spec                                                       | Status                | Summary                                                                                                                                             |
| ---------- | ---------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-15 | [Prototype](./2026-05-15-prototype.md)                     | Implemented (#4, #16) | Full prototype: pipeline, screens, session storage, personas, headphone button, tool use. TTS section and talk-phase tap behavior since superseded. |
| 2026-05-21 | [Release pipeline](./2026-05-21-release-pipeline.md)       | Implemented (#8)      | GitHub Actions builds a signed APK and publishes a Release on every version-bumped merge to `main`.                                                 |
| 2026-05-28 | [Debug build co-installation](./2026-05-28-debug-build.md) | Implemented (#15)     | Debug (`com.yunto.app.debug`, "Yunto Dev") installs alongside the release app.                                                                      |
| 2026-06-03 | [Streaming TTS](./2026-06-03-tts-streaming.md)             | Implemented (#20)     | Real streaming TTS via ElevenLabs WebSocket + native `AudioTrack` PCM. Supersedes the prototype's per-chunk REST TTS.                               |
| 2026-06-04 | [Bluetooth mic capture](./2026-06-04-bluetooth-mic.md)     | Implemented (#19)     | Capture from a connected Bluetooth headset mic (HFP/SCO) with phone-mic fallback. Changes the talk-phase tap rule to "any tap = stop".              |
