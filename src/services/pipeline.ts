import { RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import * as Speech from "expo-speech";
import { useCallback, useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";

import HeadphoneButtonModule from "../../modules/headphone-button/index.js";
import { getPersona as getPersonaContent } from "../constants/personas.js";
import { LlmError, streamWithTools } from "./llm.js";
import {
  type Session,
  appendMessage,
  createSession,
  getOrCreateActiveSession,
} from "./sessionStore.js";
import {
  getApiKeys,
  getPermissionsRequested,
  getPersona,
  getPlaybackSpeed,
  hasApiKeys,
  setPermissionsRequested,
} from "./settingsStore.js";
import { initBeeps, playStartBeep, playStopBeep, playThinkingTone } from "./sounds.js";
import { SttError, transcribeAudio } from "./stt.js";
import { deleteTempFile, fetchTtsAudio, playAudioFile, TtsError } from "./tts.js";

export type PipelineStatus =
  | "idle"
  | "connecting"
  | "recording"
  | "processing"
  | "thinking"
  | "searching"
  | "speaking";

export type MicSource = "bluetooth" | "phone";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const SENTENCE_END = /[.?!](\s|$)|\.{3}(\s|$)|\n\n/;
export const MAX_CHUNK_TOKENS = 40;

// Max wait for the Bluetooth SCO link before falling back to the phone mic.
const SCO_CONNECT_TIMEOUT_MS = 3000;
// Grace period after tearing SCO down so A2DP resumes before the reply plays back in hi-fi.
const A2DP_RESUME_SETTLE_MS = 400;

const isAndroid = Platform.OS === "android";

// Requests RECORD_AUDIO (and BLUETOOTH_CONNECT on Android 12+) once, up front, so the
// foreground service can carry the microphone type and we can route to a named BT device.
async function requestInitialPermissions(): Promise<void> {
  if (!isAndroid) return;
  if (await getPermissionsRequested()) return;
  const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (typeof Platform.Version === "number" && Platform.Version >= 31) {
    perms.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  }
  try {
    await PermissionsAndroid.requestMultiple(perms);
  } catch {
    // Ignore — recording falls back to the phone mic if a permission is missing.
  }
  await setPermissionsRequested();
}

function detectMicSource(): MicSource {
  if (!isAndroid) return "phone";
  return HeadphoneButtonModule.getInputState()?.bluetoothUid ? "bluetooth" : "phone";
}

export function usePipeline() {
  const [displayStatus, setDisplayStatus] = useState<PipelineStatus>("idle");
  const [session, setSession] = useState<Session | null>(null);
  const [keysPresent, setKeysPresent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [micSource, setMicSource] = useState<MicSource | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const statusRef = useRef<PipelineStatus>("idle");
  const sessionRef = useRef<Session | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoActiveRef = useRef(false);
  // Refs let the once-registered SCO listener call the latest callbacks.
  const cancelAllRef = useRef<() => void>(() => {});
  const speakErrorRef = useRef<(message: string, cause?: unknown) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  function updateStatus(s: PipelineStatus) {
    statusRef.current = s;
    setDisplayStatus(s);
  }

  const refreshMicSource = useCallback(() => {
    setMicSource(detectMicSource());
  }, []);

  const releaseSco = useCallback(() => {
    if (scoActiveRef.current) {
      scoActiveRef.current = false;
      HeadphoneButtonModule.releaseBluetoothSco();
    }
  }, []);

  function updateSession(s: Session) {
    sessionRef.current = s;
    setSession(s);
  }

  useEffect(() => {
    async function init() {
      await setAudioModeAsync({
        interruptionMode: "doNotMix",
        playsInSilentMode: true,
        shouldPlayInBackground: true,
      });
      await requestInitialPermissions();
      if (isAndroid) {
        // Re-apply the FGS type now that RECORD_AUDIO may have just been granted.
        HeadphoneButtonModule.refreshForegroundServiceType();
        refreshMicSource();
      }
      await initBeeps().catch(() => {});
      const active = await getOrCreateActiveSession();
      updateSession(active);
      const keys = await hasApiKeys();
      setKeysPresent(keys);
    }
    init();
  }, [refreshMicSource]);

  // The headset's own hang-up (SCO drop while the headset stays connected) is the explicit
  // BT-mode stop — its button is hijacked by call mode and can't reach us. Losing the headset
  // entirely aborts the turn.
  useEffect(() => {
    if (!isAndroid) return;
    const sub = HeadphoneButtonModule.addListener("onBluetoothScoChanged", (event) => {
      if (statusRef.current === "idle") return;
      if (event.state === "stop") {
        if (statusRef.current === "recording") stopRef.current();
      } else {
        cancelAllRef.current();
        updateStatus("idle");
        refreshMicSource();
        speakErrorRef.current("Bluetooth disconnected.");
      }
    });
    return () => sub.remove();
  }, [refreshMicSource]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(async () => {
      if (statusRef.current === "idle") {
        const fresh = await createSession();
        updateSession(fresh);
      }
    }, IDLE_TIMEOUT_MS);
  }, []);

  const speakError = useCallback((message: string, cause?: unknown) => {
    console.error("[pipeline]", message, cause ?? "");
    setErrorMessage(message);
    Speech.speak(message, { language: "en" });
  }, []);

  const cancelAll = useCallback(() => {
    Speech.stop();
    abortRef.current?.abort();
    abortRef.current = null;
    if (statusRef.current === "recording" || statusRef.current === "connecting") {
      recorder.stop().catch(() => {});
    }
    releaseSco();
  }, [recorder, releaseSco]);

  cancelAllRef.current = cancelAll;
  speakErrorRef.current = speakError;

  const startRecording = useCallback(async () => {
    setErrorMessage(null);
    try {
      const btUid = isAndroid
        ? (HeadphoneButtonModule.getInputState()?.bluetoothUid ?? null)
        : null;
      await recorder.prepareToRecordAsync();

      if (btUid) {
        // Gate the start cue: bring SCO up first, only beep once we can actually capture.
        updateStatus("connecting");
        const connected = await HeadphoneButtonModule.connectBluetoothSco(SCO_CONNECT_TIMEOUT_MS);
        let routed = false;
        if (connected) {
          try {
            recorder.setInput(btUid);
            routed = true;
          } catch {
            routed = false;
          }
        }
        if (routed) {
          scoActiveRef.current = true;
          recorder.record();
          playStartBeep();
          setMicSource("bluetooth");
          updateStatus("recording");
          return;
        }
        // SCO didn't connect (or routing failed): fall back to the phone mic and say so.
        releaseSco();
        recorder.record();
        playStartBeep();
        setMicSource("phone");
        updateStatus("recording");
        Speech.speak("Using phone microphone", { language: "en" });
        return;
      }

      recorder.record();
      playStartBeep();
      setMicSource("phone");
      updateStatus("recording");
    } catch (e) {
      releaseSco();
      updateStatus("idle");
      speakError("Microphone access failed. Please try again.", e);
    }
  }, [recorder, speakError, releaseSco]);

  const stopRecordingAndProcess = useCallback(async () => {
    // Idempotent: the headset hang-up event and an on-screen tap can both fire.
    if (statusRef.current !== "recording") return;
    const currentSession = sessionRef.current;
    if (!currentSession) return;

    playStopBeep();
    updateStatus("processing");
    await recorder.stop();
    const audioUri = recorder.uri;

    if (scoActiveRef.current) {
      // Tear SCO down now so playback returns to hi-fi A2DP; settle lets A2DP resume
      // before the first TTS chunk so the reply isn't clipped or narrowband.
      releaseSco();
      await new Promise<void>((r) => setTimeout(r, A2DP_RESUME_SETTLE_MS));
    }

    if (!audioUri) {
      speakError("Recording failed. Please try again.");
      updateStatus("idle");
      return;
    }

    playThinkingTone();
    Speech.speak("Thinking", { language: "en" });

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const [keys, personaKey, playbackSpeed] = await Promise.all([
        getApiKeys(),
        getPersona(),
        getPlaybackSpeed(),
      ]);

      if (!keys.openaiKey || !keys.anthropicKey || !keys.elevenLabsKey) {
        const missing = [
          !keys.openaiKey && "OpenAI",
          !keys.anthropicKey && "Anthropic",
          !keys.elevenLabsKey && "ElevenLabs",
        ]
          .filter(Boolean)
          .join(", ");
        speakError(`Missing API keys: ${missing}. Please check Settings.`);
        updateStatus("idle");
        return;
      }

      const persona = getPersonaContent(personaKey);

      const transcript = await transcribeAudio(audioUri, keys.openaiKey, abort.signal);
      if (abort.signal.aborted) return;
      if (!transcript) {
        Speech.stop();
        playStopBeep();
        updateStatus("idle");
        return;
      }

      let session = await appendMessage(currentSession, {
        role: "user",
        content: transcript,
        timestamp: new Date().toISOString(),
      });
      updateSession(session);

      updateStatus("thinking");

      let fullResponse = "";
      let tokenBuffer = "";
      let tokenCount = 0;
      const ttsQueue: Promise<string>[] = [];
      const isDone = { value: false };
      let drainPromise: Promise<void> | null = null;

      async function drainQueue() {
        Speech.stop();
        updateStatus("speaking");
        let i = 0;
        while (true) {
          if (abort.signal.aborted) break;
          if (i < ttsQueue.length) {
            const uri = await ttsQueue[i]!;
            i++;
            if (!abort.signal.aborted) {
              await playAudioFile(uri, abort.signal, playbackSpeed);
            }
            await deleteTempFile(uri);
          } else if (isDone.value) {
            break;
          } else {
            await new Promise<void>((r) => setTimeout(r, 20));
          }
        }
      }

      function flushBuffer() {
        const text = tokenBuffer.trim();
        if (!text) return;
        const p = fetchTtsAudio(text, keys.elevenLabsKey, abort.signal);
        p.catch(() => {}); // drain loop re-catches; this silences the unhandled-rejection warning
        ttsQueue.push(p);
        if (!drainPromise) {
          drainPromise = drainQueue();
        }
        tokenBuffer = "";
        tokenCount = 0;
      }

      const llmStream = streamWithTools(
        session.messages,
        persona.systemPrompt,
        keys.anthropicKey,
        abort.signal,
        () => {
          Speech.stop();
          updateStatus("searching");
          Speech.speak("Searching", { language: "en" });
        },
      );

      for await (const token of llmStream) {
        if (abort.signal.aborted) break;
        fullResponse += token;
        tokenBuffer += token;
        tokenCount++;
        if (SENTENCE_END.test(tokenBuffer) || tokenCount >= MAX_CHUNK_TOKENS) {
          flushBuffer();
        }
      }

      if (!abort.signal.aborted) flushBuffer();
      isDone.value = true;

      if (drainPromise) await drainPromise;
      if (abort.signal.aborted) return;

      session = await appendMessage(session, {
        role: "assistant",
        content: fullResponse,
        timestamp: new Date().toISOString(),
      });
      updateSession(session);
      resetIdleTimer();
    } catch (err) {
      Speech.stop();
      if (abort.signal.aborted) return;
      if (err instanceof SttError) {
        speakError(err.message, err);
      } else if (err instanceof LlmError) {
        speakError(err.message, err);
      } else if (err instanceof TtsError) {
        speakError(err.message, err);
      } else {
        speakError("Something went wrong. Please try again.", err);
      }
    } finally {
      if (!abort.signal.aborted) {
        updateStatus("idle");
      }
    }
  }, [recorder, speakError, resetIdleTimer, releaseSco]);

  stopRef.current = stopRecordingAndProcess;

  const handleSinglePress = useCallback(async () => {
    if (!keysPresent) {
      speakError("Please add your API keys in Settings.");
      return;
    }
    const current = statusRef.current;
    if (current === "connecting") {
      // Bringing up the Bluetooth link; ignore presses until it resolves.
      return;
    }
    if (current === "idle") {
      await startRecording();
    } else if (current === "recording") {
      await stopRecordingAndProcess();
    } else {
      // Barge-in: cancel pipeline, start fresh recording
      cancelAll();
      updateStatus("idle");
      await startRecording();
    }
  }, [keysPresent, startRecording, stopRecordingAndProcess, cancelAll, speakError]);

  const handleDoublePress = useCallback(async () => {
    if (statusRef.current !== "idle") {
      cancelAll();
      updateStatus("idle");
    } else {
      const fresh = await createSession();
      updateSession(fresh);
      await startRecording();
    }
  }, [cancelAll, startRecording]);

  const startNewSession = useCallback(async () => {
    cancelAll();
    updateStatus("idle");
    const fresh = await createSession();
    updateSession(fresh);
    await startRecording();
  }, [cancelAll, startRecording]);

  const refreshApiKeyStatus = useCallback(async () => {
    const keys = await hasApiKeys();
    setKeysPresent(keys);
  }, []);

  const cancelPipeline = useCallback(() => {
    cancelAll();
    updateStatus("idle");
  }, [cancelAll]);

  return {
    status: displayStatus,
    session,
    keysPresent,
    errorMessage,
    micSource,
    handleSinglePress,
    handleDoublePress,
    cancelPipeline,
    startNewSession,
    refreshApiKeyStatus,
    refreshMicSource,
  };
}
