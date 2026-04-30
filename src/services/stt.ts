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
): Promise<string> {
  const formData = new FormData();
  formData.append("file", {
    uri: audioUri,
    name: "audio.m4a",
    type: "audio/m4a",
  } as unknown as Blob);
  formData.append("model", "whisper-1");
  formData.append("language", "en");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: formData,
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

  const data = (await response.json()) as { text: string };
  const transcript = data.text.trim();
  if (!transcript) {
    throw new SttError("No speech detected. Please try again.");
  }
  return transcript;
}
