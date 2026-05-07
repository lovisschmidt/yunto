import * as FileSystem from "expo-file-system/legacy";
import HeadphoneButtonModule from "../../modules/headphone-button/index.js";

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
    if (response.status === 401) {
      throw new TtsError("Invalid ElevenLabs API key. Please check Settings.");
    }
    if (response.status === 402) {
      throw new TtsError("ElevenLabs quota exceeded. Upgrade your plan or wait for monthly reset.");
    }
    if (response.status === 429) {
      throw new TtsError("ElevenLabs rate limit reached. Please wait a moment.");
    }
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

export async function playAudioFile(uri: string, signal: AbortSignal, speed = 1.0): Promise<void> {
  if (signal.aborted) return;

  return new Promise<void>((resolve) => {
    const subscription = HeadphoneButtonModule.addListener("onPlaybackComplete", () => {
      subscription.remove();
      signal.removeEventListener("abort", onAbort);
      resolve();
    });

    const onAbort = () => {
      subscription.remove();
      HeadphoneButtonModule.stopPlayback();
      resolve();
    };
    signal.addEventListener("abort", onAbort);

    HeadphoneButtonModule.playUri(uri, speed);
  });
}

export async function deleteTempFile(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // best-effort cleanup
  }
}
