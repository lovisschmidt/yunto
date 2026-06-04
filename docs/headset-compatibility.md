# Bluetooth headset compatibility

A community-maintained record of how specific Bluetooth headsets behave with Yunto's
mic capture and **stop gesture**. This is field knowledge that can't be derived from the
code — it depends on each headset's firmware — so please add a row if you test one.

## Why headsets differ

Yunto records through a classic-BT headset mic over **HFP/SCO**, which puts the headset
into a call. During a call the headset firmware owns the multifunction button and does
**not** forward it to Yunto's MediaSession — so the usual "press again to stop" can't reach
the app.

To stop anyway, Yunto watches the captured audio: many headsets **mute the SCO uplink**
when you use their in-call tap gesture, which drops the mic stream to **true digital silence
(~-160 dBFS)**. Yunto treats ~0.9s of that as a deliberate stop. A live mic floors well above
this (~-70 dBFS) even during a thinking pause, so natural pauses don't false-stop.

This works only if the headset behaves a certain way, hence the variation:

| Headset behavior on in-call tap                            | Result in Yunto                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Mutes the uplink (drops to true silence)                   | ✅ Tap-to-stop works in BT mode                                              |
| Does something else (next track, voice assistant, nothing) | ⚠️ No stop signal — use the **on-screen center tap** to stop                 |
| Transmits comfort noise / DTX during pauses                | ⚠️ May false-stop on a long pause — prefer the on-screen tap                 |
| Output-only / A2DP-only (no HFP mic)                       | ℹ️ No BT mic; Yunto records on the phone mic (no degradation to the gesture) |

The **on-screen center tap always stops**, on every headset, in every mode. The headset
gesture is a convenience that depends on the table above.

## How to contribute a row

Test on a real device (the emulator can't do SCO) and open a PR (or issue) adding a row with:

- Headset model + firmware if known
- Android version / device
- **BT mic capture** — did SCO connect and was the transcript clear?
- **In-call tap → stop** — does a tap on the headset stop the turn, or do you need the on-screen tap?
- Any quirks (pauses false-stopping, fallback to phone mic, disconnect behavior)

## Tested headsets

| Headset              | Android / device   | BT mic capture (SCO)          | In-call tap → stop                  | Notes                                                                                       | Reported            |
| -------------------- | ------------------ | ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- | ------------------- |
| Jabra Elite 8 Active | (prototype device) | ✅ Connects, clear transcript | ✅ Mutes uplink on tap → clean stop | Ambient floor ~-70 dBFS during pauses, hard -160 on mute — clean separation, no false-stops | Maintainer, 2026-06 |

_Add your headset above. Even a "doesn't work / use on-screen tap" row is useful — it tells the next person what to expect._
