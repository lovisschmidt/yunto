# Spec: Bluetooth headphone microphone capture

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
reliable "connected" signal (to gate the start cue), drop detection (to tell an intentional stop from a
real disconnect), clean teardown (so a failed connect never leaves the session stuck in call mode), the
`BLUETOOTH_CONNECT` permission, and the `microphone` foreground-service type for screen-off recording.

Scope is **classic HFP/SCO Bluetooth only**. LE Audio is out of scope for now but the design is built to
accept it later (see "LE Audio — future fit").

## The stop problem (why this isn't a normal push-to-talk)

Capturing a classic-BT headset mic requires HFP/SCO, which puts the headset into a **call**. During a
call the headset firmware owns the multifunction button (mute / hang-up per the HFP spec) and does **not**
forward it to our MediaSession — so the usual "press again to stop" never reaches us. We deliberately do
**not** solve this with silence/VAD auto-stop: the explicit stop is a core product requirement so the
user can take long thinking pauses without being cut off early. Instead we **intercept the headset's own
hang-up** (the gesture that ends the call — double-tap on the test headset) as the explicit stop: ending
the call drops the SCO link, which we detect and treat as "stop & finalize this recording." The
recording captured up to that instant is intact, so we just process it.

This makes the BT-mode interaction asymmetric but hands-free: **media-button press to start, headset
hang-up to stop.**

## Decisions

| Topic                          | Decision                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Mic selection                  | **Auto** — always prefer the BT mic when a BT headset with a mic is connected. No user toggle.                                    |
| SCO scope per turn             | SCO **only during recording**; tear it down before TTS so replies play in full A2DP hi-fi.                                        |
| SCO timing                     | **Gate the start cue**: bring SCO up on record press; delay the start beep until SCO is connected.                                |
| SCO connect timeout            | **~3s**, then fall back to phone mic. A failed/timed-out connect restores `MODE_NORMAL` (no stuck call mode).                     |
| Explicit stop (BT mode)        | **Intercept the headset hang-up.** SCO drop while the headset stays connected = stop & process. On-screen tap is a manual backup. |
| Mid-turn BT disconnect         | Headset **gone entirely** (BT output device removed) = **abort + notify** (spoken + visual).                                      |
| No silence auto-stop           | Explicit stop is deliberate — it lets the user pause to think. Never end a turn on detected silence.                              |
| Implementation                 | **Native SCO controller** in the existing `headphone-button` Expo module; drives the expo-audio recorder.                         |
| BT mic unavailable / SCO fails | Fall back to phone mic, indicate **both visually (badge) and audibly (spoken cue)**.                                              |
| Background / screen-off mic    | Add `microphone` FGS type + `FOREGROUND_SERVICE_MICROPHONE`.                                                                      |
| BT scope                       | Classic **HFP/SCO only** now; LE Audio is a later additive transport.                                                             |
| BLUETOOTH_CONNECT permission   | Request **upfront, bundled with the mic-permission** flow.                                                                        |
| Mic indicator                  | **Persistent badge** near the Home status label ("Bluetooth mic" / "Phone mic").                                                  |
| Audio cue                      | **Spoken, only on fallback** ("Using phone microphone").                                                                          |
| Verification                   | Manual on-device checklist; run on a real phone + headset.                                                                        |

## Goals / Non-goals

- **Goal**: When a classic-BT headset with a mic is connected, record through it; stop via the headset
  hang-up; fall back to the phone mic with clear visual+audio feedback; preserve hi-fi TTS playback.
- **Non-goal**: silence/VAD auto-stop (explicitly rejected); wired-headset selection; a device-picker UI;
  iOS (app is Android-only).

## Architecture & changes

### 1. Native — `modules/headphone-button` (`HeadphoneButtonModule.kt`)

The module owns `AudioManager` access, the `MediaSession`, and audio focus — the right home for SCO
control. New API (TS surface in `modules/headphone-button/src/`):

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

**Drop detection (the core of the stop model).** In `onAudioDevicesRemoved`, ignore removals while
`expectingTeardown`. Otherwise:

- BT mic (SCO) removed **and the BT output device (A2DP/BLE) is still connected** → the user hung up →
  emit `state: "stop"`.
- The BT output device is gone (headset removed entirely) → emit `state: "disconnected"`.

Checking the _live_ output-device list (not just the removed-batch) makes the common cases robust to
split callbacks; a sudden out-of-range drop reports `disconnected`, a hang-up reports `stop`.

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
`scoActiveRef`; a once-registered `onBluetoothScoChanged` listener (calls the latest handlers via refs).

- New status `"connecting"` for the SCO-connect window (label "Connecting headphones…").
- `startRecording()`: read `getInputState().bluetoothUid`. If present → status `connecting`, **no beep**,
  `prepareToRecordAsync()`, `await connectBluetoothSco(3000)`. Connected → `setInput(bluetoothUid)`,
  `record()`, beep, `micSource="bluetooth"`, `scoActiveRef=true`. Failed → `releaseBluetoothSco()`,
  record on phone mic, beep, `micSource="phone"`, **speak "Using phone microphone"**. No BT mic → phone
  mic, no cue.
- `stopRecordingAndProcess()`: guarded to no-op unless status is `recording` (idempotent against the
  event + on-screen tap racing). On stop, if `scoActiveRef`: `releaseBluetoothSco()` + brief settle, then
  the existing Whisper→LLM→TTS pipeline (TTS plays via `HeadphoneButtonModule.playUri`, `USAGE_MEDIA` →
  A2DP). On a hang-up stop the headset has already restored A2DP, so the reply is hi-fi with no race.
- Listener: `state:"stop"` while `recording` → `stopRecordingAndProcess()` (the explicit BT stop).
  `state:"disconnected"` while not idle → `cancelAll()` + `releaseBluetoothSco()` + idle +
  `speakError("Bluetooth disconnected.")`.

### 4. UI — `src/screens/HomeScreen.tsx`

Persistent mic-source badge near the status label ("Bluetooth mic" / "Phone mic", hidden when null);
`connecting` entry in `STATUS_LABELS`; refresh `micSource` on focus. The center zone tap remains a manual
stop. No `WaveformAnimation` changes.

## LE Audio — future fit (not implemented)

The BT-mic logic is isolated in the native controller and the pipeline is transport-agnostic, so LE Audio
slots in additively when hardware is available:

- Detect `TYPE_BLE_HEADSET` alongside `TYPE_BLUETOOTH_SCO`; **prefer LE when present** (wideband LC3 mic,
  simultaneous hi-fi output — likely no narrowband teardown needed before TTS).
- The hang-up-as-stop model generalizes ("BT-mic device removed while output persists" = stop). LE _might_
  also free the normal media button (capture may still be a call-control state — verify on device).
- Wrinkle: expo-audio's `setInput` only special-cases SCO and would `clearCommunicationDevice` for a BLE
  uid, so drive routing entirely from the native controller and use `setInput` only for the preferred
  device. The payoff is quality, not necessarily a different stop UX.

## Edge cases handled

- Output-only / A2DP-only headset (no HFP mic): `bluetoothUid` null → phone mic, no cue.
- A BT mic exists but SCO won't link in ~3s → fall back + spoken cue; route restored to normal.
- Intentional teardown (`expectingTeardown`) is never mistaken for a hang-up or disconnect.
- Hang-up vs full disconnect distinguished by whether the BT output device survives.
- Screen-off / backgrounded record via the `microphone` FGS type.
- Denied `BLUETOOTH_CONNECT` → treated as no BT mic.

## Open risks (verify on-device)

- **Hang-up detection is the key unknown**: confirm the headset's hang-up (double-tap) surfaces as an SCO
  drop to Android (there's no real telco call here, just app-held SCO). The on-screen tap is the backup if
  it doesn't.
- A flaky SCO link could drop on its own and be read as a "stop" (processes a short clip). Acceptable.
- Rare split-callback ordering on a full disconnect could momentarily look like a "stop" before the
  `disconnected` follows.
- Device-specific SCO connect timing (the start settle).

## Verification (manual, real device — emulator can't do SCO)

1. **No BT** (regression): record on phone mic, badge "Phone mic", no spoken cue, transcript fine.
2. **BT connected**: press → "Connecting headphones…" → start beep → speak → **double-tap to hang up** →
   recording stops & processes → reply plays hi-fi in headphones. Badge "Bluetooth mic".
3. **Long pause**: take a multi-second pause mid-utterance → recording keeps going until you hang up (no
   premature cutoff).
4. **SCO fails**: output-only/uncooperative headset → after ~3s falls back to phone mic, badge "Phone
   mic", hears "Using phone microphone"; subsequent replies are normal volume (no stuck call mode).
5. **Full disconnect**: power off / walk out of range while recording → turn aborts, hears/sees
   "Bluetooth disconnected", returns to idle.
6. **Screen-off**: lock screen, press headphone button → recording starts (FGS microphone type); Android
   privacy mic dot appears.
7. **TTS quality**: replies after a BT turn are full hi-fi (A2DP), not phone-call quality/volume.
8. **Permissions**: fresh install → first record prompts RECORD_AUDIO + BLUETOOTH_CONNECT; deny BT →
   graceful phone-mic fallback.
9. `npm run typecheck`, `npm run lint`, `npm test` pass; `:app:compileDebugKotlin` builds.
