import * as FileSystem from "expo-file-system/legacy";
import { createAudioPlayer } from "expo-audio";
import type { AudioStatus } from "expo-audio";

const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const MODEL_ID = "eleven_flash_v2_5";

export class TtsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsError";
  }
}

export async function fetchTtsAudio(
  text: string,
  elevenLabsKey: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": elevenLabsKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
    signal,
  });

  if (!response.ok) {
    throw new TtsError(`Audio generation failed (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]!);
  }
  const base64 = btoa(binary);
  const tempUri = `${FileSystem.cacheDirectory}tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`;
  await FileSystem.writeAsStringAsync(tempUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return tempUri;
}

export async function playAudioFile(uri: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;

  return new Promise<void>((resolve) => {
    const player = createAudioPlayer({ uri });

    const onAbort = () => {
      subscription.remove();
      player.remove();
      resolve();
    };
    signal.addEventListener("abort", onAbort);

    const subscription = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
      if (status.didJustFinish) {
        signal.removeEventListener("abort", onAbort);
        subscription.remove();
        player.remove();
        resolve();
      }
    });

    player.play();
  });
}

export async function deleteTempFile(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // best-effort cleanup
  }
}
