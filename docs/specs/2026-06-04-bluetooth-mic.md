# Spec: Bluetooth headphone microphone capture

> **Status:** Implemented (#19) · **Created:** 2026-06-04
> **Supersedes** the talk-phase tap / double-press behavior of [2026-05-15-prototype](./2026-05-15-prototype.md): any tap during recording now stops & processes (no mid-talk cancel).
> **Point-in-time snapshot** of the plan as written; current behavior may have moved on. See the [spec index](./README.md).

## Context

Yunto is a voice-first, headphone-button-driven companion. The whole UX assumes the user is wearing
headphones (often with the phone pocketed), yet the original pipeline **always recorded from the phone's
built-in mic**: `src/services/pipeline.ts` uses `useAudioRecorder(RecordingPresets.HIGH_QUALITY)`, and
expo-audio's native recorder defaults to `MediaRecorder.AudioSource.MIC` because the recorder's input
device is never selected. When the user speaks into their Bluetooth headset, the pocketed phone mic
captures muffled audio → poor transcripts. This feature captures from the Bluetooth headset mic when one
is connected.

Key library finding: `expo-audio@1.1.1` already exposes `recorder.getAvailableInputs()` /
`recorder.setInput(uid)` (keyed on `AudioDeviceInfo.id`), and its native `setInput` calls
`setCommunicationDevice` (API 31+) / `startBluetoothSco` (older) + `setPreferredDevice`. So the capture
primitive exists. What's missing — and why we still need native code — is **SCO lifecycle control**: a
reliable "connected" signal (to gate the start cue), drop detection (to abort on real disconnect), clean
teardown (so a failed connect never leaves the session stuck in call mode), the `BLUETOOTH_CONNECT`
permission, and the `microphone` foreground-service type for screen-off recording.

Scope is **classic HFP/SCO Bluetooth only**. LE Audio is out of scope for now but the design is built to
accept it later (see "LE Audio — future fit").

## The stop problem and how we resolve it

Capturing a classic-BT headset mic requires HFP/SCO, which puts the headset into a **call**. During a
call the headset firmware owns the multifunction button (mute / hang-up per the HFP spec) and does **not**
forward it to our MediaSession — so the usual "press again to stop" can't reach us. An on-device probe
confirmed Android sees nothing at all on a double-tap during recording: no media-button event, no
`MICROPHONE_MUTE_CHANGED`, no `device REMOVED`. The only observable effect of the tap, on headsets that
locally mute the uplink, is that the SCO mic stream drops to **true digital silence (`metering === -160`
dBFS)**, distinct from a live thinking pause (which floors at the headset's transmitted ambient noise,
typically ~-70 dBFS).

We explicitly do **not** solve this with silence/VAD auto-stop: explicit stop is a core product
requirement so the user can take long thinking pauses without being cut off. The compromise that ships:

- **The user-facing rule:** _any tap during the talk phase = stop._ That holds in both phone-mic and
  BT-mic mode, so the gesture is consistent.
- **Internally we get there via two signals.** In phone-mic mode the tap fires a normal MediaSession
  event → stop. In BT-mic mode the tap can't reach us, but on headsets whose tap mutes the uplink the
  captured audio drops to true digital silence; we watch metering for sustained -160 and treat that as
  the deliberate-mute stop. A live thinking pause keeps the mic flowing at ~-70 (well above the
  threshold), so a pause never stops the turn.
- **There is no mid-talk cancel anymore.** Single tap and double tap both stop & process during
  recording. Cancel is still available **after** the talk phase (during the reply) and at idle, so the
  user can always abort an unwanted answer.

### v1 device limits (accepted, surfaced for community feedback)

- Headsets whose tap-during-call does something other than mute (e.g. next-track) produce no detectable
  signal — those users must stop via the on-screen tap.
- Headsets that aggressively transmit digital silence during natural pauses (DTX / comfort-noise) would
  false-stop on a thinking pause and should not rely on the detector. The Jabra Elite 8 Active used for
  the prototype confirmed ambient floor ~-70 during pauses and hard -160 on mute — clean.
- LE Audio is the longer-term clean answer (mic + button can coexist on a non-call profile), and the
  architecture accepts it additively when hardware is available — but the v1 prototype targets classic BT
  so it's testable in the community today.

## Decisions

| Topic                          | Decision                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mic selection                  | **Auto** — always prefer the BT mic when a BT headset with a mic is connected. No user toggle.                                                    |
| SCO scope per turn             | SCO **only during recording**; tear it down before TTS so replies play in full A2DP hi-fi.                                                        |
| SCO timing                     | **Gate the start cue**: bring SCO up on record press; delay the start beep until SCO is connected.                                                |
| SCO connect timeout            | **~3s**, then fall back to phone mic. A failed/timed-out connect restores `MODE_NORMAL` (no stuck call mode).                                     |
| Talk-phase taps                | **Any tap (single or double) during recording = stop & process.** No mid-talk cancel.                                                             |
| Cancel                         | Available **outside the talk phase**: at idle (irrelevant) and during reply phases (single = barge-in to new recording, double = cancel to idle). |
| BT-mode deliberate-mute stop   | Sustained `metering === -160` (≈0.9s hold, armed only after live audio is seen + ~1s startup grace) treated as a tap in BT mode.                  |
| Mid-turn BT disconnect         | Headset **gone entirely** (BT output device removed) = **abort + notify** (spoken + visual).                                                      |
| No silence auto-stop           | Live ambient never triggers stop. The detector targets the deliberate-mute -160 signature, not natural quiet.                                     |
| Implementation                 | **Native SCO controller** in the existing `headphone-button` Expo module; drives the expo-audio recorder.                                         |
| BT mic unavailable / SCO fails | Fall back to phone mic, indicate **both visually (badge) and audibly (spoken cue)**.                                                              |
| Background / screen-off mic    | Add `microphone` FGS type + `FOREGROUND_SERVICE_MICROPHONE`.                                                                                      |
| BT scope                       | Classic **HFP/SCO only** now; LE Audio is a later additive transport.                                                                             |
| BLUETOOTH_CONNECT permission   | Request **upfront, bundled with the mic-permission** flow.                                                                                        |
| Mic indicator                  | **Persistent badge** near the Home status label ("Bluetooth mic" / "Phone mic").                                                                  |
| Audio cue                      | **Spoken, only on fallback** ("Using phone microphone").                                                                                          |
| Verification                   | Manual on-device checklist; run on a real phone + headset.                                                                                        |

## Goals / Non-goals

- **Goal**: When a classic-BT headset with a mic is connected, record through it; stop via any tap
  (delivered as a MediaSession event in phone mode, or as a deliberate-mute -160 signature in BT mode);
  fall back to the phone mic with clear visual+audio feedback; preserve hi-fi TTS playback.
- **Non-goal**: silence/VAD auto-stop (explicitly rejected); wired-headset selection; a device-picker UI;
  iOS (app is Android-only); spoken-keyword stop (parked for a later iteration).

## Architecture & changes

### 1. Native — `modules/headphone-button` (`HeadphoneButtonModule.kt`)

The module owns `AudioManager` access, the `MediaSession`, and audio focus — the right home for SCO
control. API (TS surface in `modules/headphone-button/src/`):

- `getInputState(): { builtInUid, bluetoothUid, bluetoothName } | null` — scans
  `getDevices(GET_DEVICES_INPUTS)`; `bluetoothUid` is the `TYPE_BLUETOOTH_SCO` device id (null below API 29
  where `setInput` is unsupported, or when no BT mic is present). uids match expo-audio's `setInput` scheme.
- `connectBluetoothSco(timeoutMs): Promise<boolean>` — `setMode(MODE_IN_COMMUNICATION)`, then API 31+:
  `setCommunicationDevice(scoDevice)` and, after a short settle for the physical link, resolve `true`
  (trusting the call's boolean result rather than re-reading `communicationDevice`, which can briefly
  report stale/null and cause false fallbacks). Pre-31: `startBluetoothSco()` + an
  `ACTION_SCO_AUDIO_STATE_UPDATED` receiver. **Every failure/timeout path tears the route back down**
  (`clearCommunicationDevice`/`stopBluetoothSco` + `MODE_NORMAL`) so the session never gets stuck in call
  mode.
- `releaseBluetoothSco(): void` — clear the communication device / stop SCO + restore `MODE_NORMAL`; sets
  an internal `expectingTeardown` flag so our own teardown isn't mistaken for a headset drop.
- `refreshForegroundServiceType(): void` — re-applies the FGS type once `RECORD_AUDIO` is granted.
- Event `onBluetoothScoChanged({ state: "stop" | "disconnected" })` — emitted from an `AudioDeviceCallback`.

**Drop detection.** In `onAudioDevicesRemoved`, ignore removals while `expectingTeardown`. Otherwise:

- BT mic (SCO) removed **and the BT output device (A2DP/BLE) is still connected** → emit `state: "stop"`
  (a headset that surfaces hang-up — kept as a bonus path; the Jabra used for the prototype does **not**
  surface this).
- The BT output device is gone (headset removed entirely) → emit `state: "disconnected"`.

Checking the _live_ output-device list (not just the removed-batch) makes this robust to split
callbacks; a sudden out-of-range drop reports `disconnected`.

Recorder binding: after `connectBluetoothSco` resolves true, JS calls `recorder.setInput(bluetoothUid)`
to set the recorder's preferred input (after `prepareToRecordAsync` so the internal `MediaRecorder`
exists). The native controller is the single owner of the communication device/mode.

### 2. Manifests & permissions

- `android/app/src/main/AndroidManifest.xml`: `BLUETOOTH_CONNECT` and
  `BLUETOOTH` (`maxSdkVersion="30"`). (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` already present.)
- `modules/headphone-button/android/src/main/AndroidManifest.xml`: `FOREGROUND_SERVICE_MICROPHONE`;
  service `foregroundServiceType="mediaPlayback|microphone"`.
- The service adds the `microphone` FGS type only once `RECORD_AUDIO` is granted (declaring it before the
  grant crashes `startForeground` on Android 14+); `refreshForegroundServiceType()` re-applies it after the
  permission prompt.
- Runtime: bundle `BLUETOOTH_CONNECT` with the first-record mic-permission flow via React Native
  `PermissionsAndroid`, gated by the existing `permissionsRequested` flag. Denied → behave as "no BT mic".

### 3. JS pipeline — `src/services/pipeline.ts`

`usePipeline()` exposes `micSource: "bluetooth" | "phone" | null` and `refreshMicSource()`. Internal
`scoActiveRef`; a once-registered `onBluetoothScoChanged` listener (calls latest handlers via refs).

- New status `"connecting"` for the SCO-connect window (label "Connecting headphones…").
- `startRecording()`: read `getInputState().bluetoothUid`. If present → status `connecting`, **no beep**,
  `prepareToRecordAsync()`, `await connectBluetoothSco(3000)`. Connected → `setInput(bluetoothUid)`,
  `record()`, beep, `micSource="bluetooth"`, `scoActiveRef=true`. Failed → `releaseBluetoothSco()`,
  record on phone mic, beep, `micSource="phone"`, **speak "Using phone microphone"**. No BT mic → phone
  mic, no cue.
- `stopRecordingAndProcess()`: guarded to no-op unless status is `recording` (idempotent against the
  tap + event + detector all racing). On stop, if `scoActiveRef`: `releaseBluetoothSco()` + brief settle,
  then the existing Whisper→LLM→TTS pipeline.
- **Talk-phase tap handling:** both `handleSinglePress` and `handleDoublePress` call
  `stopRecordingAndProcess()` when status is `recording`. Idle and reply-phase semantics are unchanged
  (idle: single = start, double = new-session+start; reply: single = barge-in, double = cancel).
- **BT-mode deliberate-mute detector:** while `displayStatus === "recording"` and `scoActiveRef.current`,
  poll `recorder.getStatus().metering` every ~200ms. Arm the detector the first time metering > -150
  (live mic flowing); once armed, count consecutive samples with metering ≤ -150. If the count reaches
  ~0.9s of continuous silence, call `stopRecordingAndProcess()` (once, via a triggered flag). Reset on
  effect entry/exit. Phone-mic mode never runs the detector.
- Listener: `state:"stop"` while `recording` → `stopRecordingAndProcess()` (bonus path for headsets that
  do surface the hang-up). `state:"disconnected"` while not idle → `cancelAll()` + idle +
  `speakError("Bluetooth disconnected.")`.

### 4. UI — `src/screens/HomeScreen.tsx`

Persistent mic-source badge near the status label ("Bluetooth mic" / "Phone mic", hidden when null);
`connecting` entry in `STATUS_LABELS`; refresh `micSource` on focus. Center-zone tap remains the always-
available manual stop. No `WaveformAnimation` changes.

## LE Audio — future fit (not implemented)

The BT-mic logic is isolated in the native controller and the pipeline is transport-agnostic, so LE Audio
slots in additively when hardware is available:

- Detect `TYPE_BLE_HEADSET` alongside `TYPE_BLUETOOTH_SCO`; **prefer LE when present** (wideband LC3 mic,
  simultaneous hi-fi output — likely no narrowband teardown needed before TTS).
- LE Audio may free the normal media button (capture is not necessarily a call-control state), which
  would let us retire the deliberate-mute detector for LE-equipped users. Verify on device when available.
- Wrinkle: expo-audio's `setInput` only special-cases SCO and would `clearCommunicationDevice` for a BLE
  uid, so drive routing entirely from the native controller and use `setInput` only for the preferred
  device. The payoff is quality, not necessarily a different stop UX.

## Edge cases handled

- Output-only / A2DP-only headset (no HFP mic): `bluetoothUid` null → phone mic, no cue.
- BT mic exists but SCO won't link in ~3s → fall back + spoken cue; route restored to normal.
- Intentional teardown (`expectingTeardown`) is never mistaken for a hang-up or disconnect.
- The detector initial -160 (before audio flows) doesn't trigger because the detector arms only after
  live audio has been seen.
- Tap + detector both firing for the same stop is idempotent: `stopRecordingAndProcess` guards on status
  and the detector uses a one-shot `triggered` flag.
- Screen-off / backgrounded record via the `microphone` FGS type.
- Denied `BLUETOOTH_CONNECT` → treated as no BT mic.

## Open risks (verify on-device)

- The deliberate-mute detector depends on the headset transmitting ambient noise during live pauses but
  true silence when muted. Confirmed on the Jabra Elite 8 Active; community feedback needed on other
  headsets, especially those that use DTX/comfort-noise (would false-stop on pauses) or whose
  tap-during-call doesn't mute (no signal at all → on-screen stop only).
- A flaky SCO link could drop on its own and be read as a hang-up "stop" (processes a short clip).
  Acceptable.
- Device-specific SCO connect timing (the start settle).

## Verification (manual, real device — emulator can't do SCO)

1. **No BT** (regression): record on phone mic, badge "Phone mic", no spoken cue, transcript fine. Tap to
   stop.
2. **BT connected, simple turn**: press → "Connecting headphones…" → start beep → speak → **mute via the
   headset's in-call gesture** → recording stops & processes (≈0.9s after mute) → reply plays hi-fi in
   headphones. Badge "Bluetooth mic".
3. **BT connected, long pause**: take a multi-second pause mid-utterance without muting → recording keeps
   going (ambient ≠ -160).
4. **BT connected, on-screen stop**: speak, then tap the on-screen center zone → recording stops &
   processes regardless of headset behavior.
5. **SCO fails**: output-only or uncooperative headset → after ~3s falls back to phone mic, badge "Phone
   mic", hears "Using phone microphone"; subsequent replies are normal volume (no stuck call mode).
6. **Full disconnect**: power off / walk out of range while recording → turn aborts, hears/sees
   "Bluetooth disconnected", returns to idle.
7. **Screen-off**: lock screen, press headphone button → recording starts (FGS microphone type); Android
   privacy mic dot appears.
8. **TTS quality**: replies after a BT turn are full hi-fi (A2DP), not phone-call quality/volume.
9. **Permissions**: fresh install → first record prompts RECORD_AUDIO + BLUETOOTH_CONNECT; deny BT →
   graceful phone-mic fallback.
10. **Reply-phase cancel**: during a reply, tap once (barge-in to new recording) and tap twice (cancel to
    idle) — both still work.
11. `npm run typecheck`, `npm run lint`, `npm test` pass; `:app:compileDebugKotlin` builds.
