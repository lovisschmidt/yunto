# Spec: Bluetooth headphone microphone capture

## Context

Yunto is a voice-first, headphone-button-driven companion. The whole UX assumes the user is wearing
headphones (often with the phone pocketed), yet the current pipeline **always records from the phone's
built-in mic**: `src/services/pipeline.ts:36` uses `useAudioRecorder(RecordingPresets.HIGH_QUALITY)`, and
expo-audio's native recorder defaults to `MediaRecorder.AudioSource.MIC` because the recorder's input
device is never selected. When the user speaks into their Bluetooth headset, the pocketed phone mic
captures muffled audio → poor transcripts. This feature captures from the Bluetooth headset mic when one
is connected.

Key library finding: `expo-audio@1.1.1` already exposes `recorder.getAvailableInputs()`,
`recorder.getCurrentInput()`, and `recorder.setInput(uid)`
(`node_modules/expo-audio/build/AudioModule.types.d.ts:252-263`). Its native `setInput` already calls
`setCommunicationDevice` (API 31+) / `startBluetoothSco` (older) + `setPreferredDevice`. So the capture
primitive exists. What's missing — and why we still need native code — is **SCO lifecycle control**: an
"SCO connected" signal (to gate the go-cue), disconnect detection (to abort), deterministic teardown
timing (to restore hi-fi playback), the `BLUETOOTH_CONNECT` permission, and the `microphone` foreground
service type for screen-off recording.

Scope is **classic HFP/SCO Bluetooth only** (the universal path). LE Audio is out of scope.

## Decisions

| Topic                          | Decision                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Mic selection                  | **Auto** — always prefer the BT mic when a BT headset with a mic is connected. No user toggle.              |
| SCO scope per turn             | SCO **only during recording**; tear it down before TTS so replies play in full A2DP hi-fi.                  |
| SCO timing                     | **Gate the go-cue**: bring SCO up on record press; delay the start beep until SCO is connected.             |
| SCO connect timeout            | **~3s**, then fall back to phone mic.                                                                       |
| Implementation                 | **Native SCO controller** added to the existing `headphone-button` Expo module; drives expo-audio recorder. |
| BT mic unavailable / SCO fails | Fall back to phone mic, indicate **both visually (badge) and audibly (spoken cue)**.                        |
| Mid-turn BT disconnect         | **Abort the turn + notify** (spoken + visual).                                                              |
| Button during SCO              | **Rely on the button, accept the remap risk.** No silence-detection backstop.                               |
| Background / screen-off mic    | Add `microphone` FGS type + `FOREGROUND_SERVICE_MICROPHONE`.                                                |
| BT scope                       | Classic **HFP/SCO only** (no LE Audio).                                                                     |
| BLUETOOTH_CONNECT permission   | Request **upfront, bundled with the mic-permission** flow.                                                  |
| Mic indicator                  | **Persistent badge** near the Home status label ("Bluetooth mic" / "Phone mic").                            |
| Audio cue                      | **Spoken, only on fallback** ("Using phone microphone").                                                    |
| Verification                   | Manual on-device checklist; run on a real phone + headset.                                                  |

## Goals / Non-goals

- **Goal**: When a classic-BT headset with a mic is connected, record the user's voice through it, with
  graceful fallback to the phone mic and clear visual+audio feedback; preserve hi-fi TTS playback.
- **Non-goal**: LE Audio; wired-headset selection changes; a device-picker UI; silence-detection mode;
  iOS (app is Android-only).

## Architecture & changes

### 1. Native — extend `modules/headphone-button`

`HeadphoneButtonService` already owns `AudioManager`, the `MediaSession`, and audio focus — the right
home for SCO control. Add a Bluetooth SCO controller plus new module methods/events.

New `HeadphoneButtonModule` API (TS surface in `modules/headphone-button/src/`):

- `getBluetoothMic(): { uid: string; name: string } | null` — scan
  `AudioManager.getDevices(GET_DEVICES_INPUTS)` for `TYPE_BLUETOOTH_SCO`; return it or null.
- `connectBluetoothSco(timeoutMs: number): Promise<boolean>` — establish SCO and resolve `true` once
  connected, `false` on timeout/failure. API 31+: `setMode(MODE_IN_COMMUNICATION)` +
  `setCommunicationDevice(scoDevice)`, confirm via `getCommunicationDevice()` (+ short settle). Pre-31:
  `setMode(MODE_IN_COMMUNICATION)` + `startBluetoothSco()`, confirm via an `ACTION_SCO_AUDIO_STATE_UPDATED`
  receiver (`SCO_AUDIO_STATE_CONNECTED`). Enforce the timeout natively.
- `releaseBluetoothSco(): void` — API 31+ `clearCommunicationDevice()`; pre-31 `stopBluetoothSco()`;
  restore `setMode(MODE_NORMAL)`. Set an internal `expectingTeardown` flag so the resulting disconnect is
  NOT treated as an unexpected drop.
- Events: `onBluetoothScoChanged({ state: "connected" | "disconnected" })`. Used to detect unexpected
  mid-turn drops.

Recorder binding: after `connectBluetoothSco` resolves true, JS calls expo-audio `recorder.setInput(scoUid)`
to bind the recorder's preferred input to the SCO device before `record()`. The native controller is the
single owner of SCO mode/device; `setInput` re-asserting the same communication device should be
idempotent — **verify on-device** that it doesn't toggle the link. On teardown, call
`recorder.setInput(builtInUid)` and `releaseBluetoothSco()`.

### 2. Manifests & permissions

- `android/app/src/main/AndroidManifest.xml`: add
  `<uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>` and
  `<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30"/>`.
  (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` already present.)
- `modules/headphone-button/android/src/main/AndroidManifest.xml`: add `FOREGROUND_SERVICE_MICROPHONE`;
  change the service's `android:foregroundServiceType="mediaPlayback"` → `"mediaPlayback|microphone"`.
- Ensure `RECORD_AUDIO` is granted **before** the foregrounded service runs with the microphone type
  (Android 14 requirement). If granted later, restart the service.
- Runtime request: bundle `BLUETOOTH_CONNECT` with the existing first-record mic-permission flow (React
  Native `PermissionsAndroid` for `BLUETOOTH_CONNECT` alongside expo-audio's recording permission).
  Reuse the existing `permissionsRequested` flag in `src/services/settingsStore.ts` to gate the one-time
  upfront request. Denied `BLUETOOTH_CONNECT` → behave as "no BT mic" (phone mic).

### 3. JS pipeline — `src/services/pipeline.ts`

Add `micSource: "bluetooth" | "phone" | null` state to `usePipeline()` and return it. Track an internal
`scoActiveRef` and subscribe to `onBluetoothScoChanged`.

- New status `"connecting"` for the brief SCO-connect window (label "Connecting headphones…").
- `startRecording()`:
  - `const btMic = HeadphoneButtonModule.getBluetoothMic()`.
  - If `btMic`: status → `connecting`; **no beep yet**; `await connectBluetoothSco(3000)`.
    - Connected → `recorder.setInput(btMic.uid)`, `prepareToRecordAsync()`, `record()`, `playStartBeep()`,
      status → `recording`, `micSource = "bluetooth"`, `scoActiveRef = true`.
    - Timed out / failed → `releaseBluetoothSco()`, fall back to phone-mic record, `playStartBeep()`,
      status → `recording`, `micSource = "phone"`, **speak "Using phone microphone"**.
  - If no `btMic`: existing path; `micSource = "phone"`, no spoken cue.
- `stopRecordingAndProcess()`: `playStopBeep()`; `recorder.stop()`; **if `scoActiveRef`**: clear flag,
  `recorder.setInput(builtInUid)`, `releaseBluetoothSco()`, brief settle (~300-500ms or until the
  communication device is cleared) so A2DP resumes before the first TTS chunk. Then continue the existing
  Whisper→LLM→TTS pipeline unchanged (TTS already plays via `HeadphoneButtonModule.playUri` with
  `USAGE_MEDIA` → routes to A2DP).
- Mid-turn drop: on `onBluetoothScoChanged({state:"disconnected"})` while `scoActiveRef` and NOT an
  expected teardown → `cancelAll()`, `releaseBluetoothSco()`, status → idle,
  `speakError("Bluetooth disconnected.")` (spoken + red banner).
- Optional optimization (skip if it complicates per-call options): use a mono ~16kHz AAC recording
  profile on SCO (matches the narrowband source; smaller file; faster Whisper upload).

### 4. UI — `src/screens/HomeScreen.tsx`

Add a small persistent badge near the status label (~line 88) bound to `micSource`: "Bluetooth mic" /
"Phone mic" (hidden when null). Add the `connecting` entry to `STATUS_LABELS` (`src/screens/HomeScreen.tsx:14`).
No `WaveformAnimation` changes.

## Edge cases handled

- Output-only / A2DP-only headset (no HFP mic): `getBluetoothMic()` returns null → phone mic, no cue
  (no BT mic was ever expected). If a BT mic exists but SCO won't link in 3s → fall back + spoken cue.
- Distinguish **intentional** SCO teardown (stop) from **unexpected** drop via `expectingTeardown`.
- Screen-off / backgrounded record via the `microphone` FGS type.
- Denied `BLUETOOTH_CONNECT` → treated as no BT mic.

## Open risks (verify on-device)

- Multifunction-button remap to call-control during SCO may swallow the STOP press on some headsets
  (accepted; on-screen tap-to-stop remains).
- A2DP-resume race could clip the first TTS word after teardown (mitigated by the settle).
- Dual ownership of the communication device between the native controller and expo-audio `setInput` —
  verify it doesn't toggle the SCO link.
- Device-specific SCO connect timing.

## Verification (manual, real device — emulator can't do SCO)

1. **No BT** (regression): record on phone mic, badge "Phone mic", no spoken cue, transcript fine.
2. **BT connected**: press → "Connecting headphones…" → go-cue beep → speak → stop → reply plays hi-fi in
   headphones. Badge "Bluetooth mic". Transcript quality reasonable.
3. **SCO timeout**: output-only headset → after ~3s falls back to phone mic, badge "Phone mic", hears
   "Using phone microphone".
4. **Mid-record disconnect**: power off headset while recording → turn aborts, hears/sees "Bluetooth
   disconnected", returns to idle.
5. **Screen-off**: lock screen, press headphone button → recording starts (FGS microphone type); Android
   privacy mic dot appears.
6. **Stop press during SCO**: confirm the second press stops recording on the test headset (note if it
   fails — accepted risk).
7. **TTS quality**: after a BT recording, reply audio is full hi-fi (A2DP), not phone-call quality
   (verifies teardown before playback).
8. **Permissions**: fresh install → first record prompts RECORD_AUDIO + BLUETOOTH_CONNECT; deny BT →
   graceful phone-mic fallback.
9. `npm run typecheck`, `npm run lint`, `npm test` pass.
