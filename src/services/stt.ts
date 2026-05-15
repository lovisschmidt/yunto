import { fetch } from "expo/fetch";
import * as FileSystem from "expo-file-system/legacy";

export class SttError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SttError";
  }
}

export async function transcribeAudio(
  audioUri: string,
  openaiKey: string,
  signal: AbortSignal,
): Promise<string | null> {
  const base64 = await FileSystem.readAsStringAsync(audioUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = atob(base64);
  const audioBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) audioBytes[i] = binary.charCodeAt(i)!;

  // expo/fetch uses OkHttp natively and rejects the RN { uri, name, type } FormData shorthand
  // as well as standard Blob objects. Build the multipart body manually as a Uint8Array instead.
  const boundary = "----FormBoundaryYuntoAudioUpload1a2b3c4d";
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.m4a"\r\nContent-Type: audio/m4a\r\n\r\n`,
    ),
    audioBytes,
    enc.encode(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`,
    ),
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`,
    ),
    enc.encode(`--${boundary}--\r\n`),
  ];
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const body = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new SttError("Invalid OpenAI API key. Please check Settings.", 401);
    }
    if (response.status === 413) {
      throw new SttError("Recording too long. Please try a shorter message.", 413);
    }
    if (response.status === 429) {
      throw new SttError("OpenAI rate limit reached. Please wait a moment.", 429);
    }
    throw new SttError(`Speech recognition failed (${response.status})`, response.status);
  }

  const data = (await response.json()) as {
    text: string;
    segments?: Array<{ no_speech_prob: number }>;
  };
  const transcript = data.text.trim();
  const noSpeechProb = data.segments?.[0]?.no_speech_prob ?? 0;
  if (!transcript || noSpeechProb > 0.6) return null;
  return transcript;
}
