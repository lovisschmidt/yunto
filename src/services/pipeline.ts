import { RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import * as Speech from "expo-speech";
import { useCallback, useEffect, useRef, useState } from "react";

import { getPersona as getPersonaContent } from "../constants/personas.js";
import { LlmError, streamWithTools } from "./llm.js";
import {
  type Session,
  appendMessage,
  createSession,
  getOrCreateActiveSession,
} from "./sessionStore.js";
import { getApiKeys, getPersona, getPlaybackSpeed, hasApiKeys } from "./settingsStore.js";
import { initBeeps, playStartBeep, playStopBeep, playThinkingTone } from "./sounds.js";
import { SttError, transcribeAudio } from "./stt.js";
import { MODEL_ID, openTtsStream, TtsStreamError, VOICE_ID } from "./ttsStream.js";

export type PipelineStatus =
  | "idle"
  | "recording"
  | "processing"
  | "thinking"
  | "searching"
  | "speaking";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const SAMPLE_RATE = 22050;

export function usePipeline() {
  const [displayStatus, setDisplayStatus] = useState<PipelineStatus>("idle");
  const [session, setSession] = useState<Session | null>(null);
  const [keysPresent, setKeysPresent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const statusRef = useRef<PipelineStatus>("idle");
  const sessionRef = useRef<Session | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function updateStatus(s: PipelineStatus) {
    statusRef.current = s;
    setDisplayStatus(s);
  }

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
      await initBeeps().catch(() => {});
      const active = await getOrCreateActiveSession();
      updateSession(active);
      const keys = await hasApiKeys();
      setKeysPresent(keys);
    }
    init();
  }, []);

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
    if (statusRef.current === "recording") {
      recorder.stop().catch(() => {});
    }
  }, [recorder]);

  const startRecording = useCallback(async () => {
    setErrorMessage(null);
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      playStartBeep();
      updateStatus("recording");
    } catch (e) {
      speakError("Microphone access failed. Please try again.", e);
    }
  }, [recorder, speakError]);

  const stopRecordingAndProcess = useCallback(async () => {
    const currentSession = sessionRef.current;
    if (!currentSession) return;

    playStopBeep();
    updateStatus("processing");
    await recorder.stop();
    const audioUri = recorder.uri;

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
      let firstAudio = false;

      const tts = openTtsStream({
        apiKey: keys.elevenLabsKey,
        voiceId: VOICE_ID,
        modelId: MODEL_ID,
        sampleRate: SAMPLE_RATE,
        speed: playbackSpeed,
        signal: abort.signal,
        onFirstAudio: () => {
          firstAudio = true;
          Speech.stop();
          updateStatus("speaking");
        },
      });

      const llmStream = streamWithTools(
        session.messages,
        persona.systemPrompt,
        keys.anthropicKey,
        abort.signal,
        () => {
          // Only a spoken hint if a tool fires before any audio has started.
          if (!firstAudio) {
            Speech.stop();
            updateStatus("searching");
            Speech.speak("Searching", { language: "en" });
          }
        },
      );

      for await (const token of llmStream) {
        if (abort.signal.aborted) break;
        fullResponse += token;
        tts.feed(token);
      }

      if (!abort.signal.aborted) await tts.end(); // resolves after AudioTrack fully drains
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
      } else if (err instanceof TtsStreamError) {
        speakError(err.message, err);
      } else {
        speakError("Something went wrong. Please try again.", err);
      }
    } finally {
      if (!abort.signal.aborted) {
        updateStatus("idle");
      }
    }
  }, [recorder, speakError, resetIdleTimer]);

  const handleSinglePress = useCallback(async () => {
    if (!keysPresent) {
      speakError("Please add your API keys in Settings.");
      return;
    }
    const current = statusRef.current;
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
    handleSinglePress,
    handleDoublePress,
    cancelPipeline,
    startNewSession,
    refreshApiKeyStatus,
  };
}
