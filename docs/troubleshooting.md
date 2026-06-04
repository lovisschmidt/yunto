# Troubleshooting & FAQ

Yunto is a sideloaded, bring-your-own-key Android app. Most issues fall into one of the
categories below. For Bluetooth-headset–specific behavior, see
[headset-compatibility.md](./headset-compatibility.md).

## Setup

### Which API keys do I need?

Three, all entered in **Settings** on first run. Each is stored only on your device
(`expo-secure-store`) and used directly from the app — there is no Yunto server.

| Key            | Used for               | Get one at                        |
| -------------- | ---------------------- | --------------------------------- |
| **OpenAI**     | Whisper speech-to-text | platform.openai.com → API keys    |
| **Anthropic**  | Claude (the LLM)       | console.anthropic.com → API keys  |
| **ElevenLabs** | Text-to-speech         | elevenlabs.io → Profile → API key |

All three are required for a full turn. Rough cost at ~30 min/day of use is **~$13–15/month**
total, billed by each provider. See the cost table in the [README](../README.md#user-cost-estimate).

### "Please add your API keys in Settings"

At least one key is missing or blank. Open **Settings**, paste all three, and save. Keys are
only checked for non-emptiness on save — a wrong key surfaces later as a spoken error
(e.g. "Invalid Anthropic API key").

## The headphone button

### Pressing the button does nothing

Android gives media-button priority to the **last app that held an active MediaSession**. If a
music/podcast app (Spotify, YouTube, etc.) is playing or was the most recent audio app, it
captures the button instead of Yunto.

- Pause/stop and fully close the other audio app, then open Yunto so it becomes the
  last-active session.
- The on-screen center tap always works regardless — use it if the physical button is being
  intercepted.

### It works at first, then stops capturing in the background

This is almost always **manufacturer battery optimization** killing the foreground service.
Samsung (One UI) and Xiaomi (MIUI/HyperOS) are the usual offenders.

- Settings → Apps → **Yunto** → Battery → set to **Unrestricted** / **Don't optimize**.
- Samsung: also remove Yunto from "Sleeping apps" / "Deep sleeping apps" (Device care → Battery).
- Xiaomi: enable **Autostart** for Yunto and set battery saver to **No restrictions**.

## Microphone & Bluetooth

### It's recording from the phone, not my headset ("Using phone microphone")

Yunto auto-prefers a connected Bluetooth headset mic, but falls back to the phone mic (with a
spoken cue and a "Phone mic" badge) when the headset's call audio link (SCO) can't be
established within ~3 seconds.

- Make sure the headset is connected and actually has a microphone (output-only/A2DP-only
  headsets have no usable mic — phone mic is expected).
- Reconnect the headset and try again; SCO links are sometimes flaky on the first attempt.
- Confirm the **Bluetooth** permission was granted (see Permissions below).
- Bluetooth mic capture needs Android 12+ for the modern routing path; on older versions it
  falls back to the phone mic.

### Recording on the headset won't stop when I tap the headset

During Bluetooth capture the headset firmware owns its button, so Yunto can't see it directly —
it instead detects the headset muting its mic. Not all headsets mute on tap. If yours doesn't,
**use the on-screen center tap to stop** (it always works). See
[headset-compatibility.md](./headset-compatibility.md) for which headsets are known to work.

### A long pause stopped my recording on a headset

A few headsets transmit digital silence (DTX/comfort-noise) during quiet moments, which can
look like a deliberate mute. If this happens to yours, stop with the on-screen tap instead, and
please add a note to [headset-compatibility.md](./headset-compatibility.md).

### "Bluetooth disconnected" mid-conversation

The headset dropped (powered off, out of range, or lost the link) while a turn was in flight.
The turn is aborted; reconnect the headset and start again. If it happened while you were
speaking, you'll hear the message; otherwise the turn is torn down quietly.

### The reply sounds like a low-quality phone call

Replies are meant to play in hi-fi. Yunto tears the call-audio (SCO) link down after recording
so playback returns to high-quality A2DP. If a reply ever sounds narrowband, the link may not
have released cleanly — start a new turn, and report it if it persists.

## Permissions

On first record Yunto requests **microphone** and (on Android 12+) **Bluetooth**. If you
denied either:

- Settings → Apps → **Yunto** → Permissions → enable **Microphone** and **Nearby devices**.
- Denying Bluetooth doesn't break the app — it just behaves as "no Bluetooth mic" and uses the
  phone mic.

## Other

### There are two Yunto icons ("Yunto" and "Yunto Dev")

Expected if a development build is installed. The release app (`com.yunto.app`) and a debug
build (`com.yunto.app.debug`, labelled **Yunto Dev**) install side by side with separate data.
Uninstall **Yunto Dev** if you only want the release app.

### Updating to a new version

Download the latest APK from [Releases](../../releases) and install over the existing one. The
release build is signed with a stable key, so updates install without uninstalling — **as long
as you keep using release APKs** (don't mix with a self-built debug APK of the same package).

### A spoken error interrupted me

Failures are announced via the phone's text-to-speech, then Yunto returns to idle. Common ones:

| You hear                                                      | Likely cause                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| "Invalid … API key. Please check Settings."                   | The key for that provider is wrong or revoked               |
| "… rate limit reached."                                       | The provider is throttling — wait a moment                  |
| "Speech recognition / AI response / Audio generation failed." | Network blip or provider outage — retry                     |
| "Using phone microphone."                                     | Bluetooth SCO didn't connect; not an error, just a heads-up |
