import * as FileSystem from "expo-file-system/legacy";
import { createAudioPlayer } from "expo-audio";
import type { AudioStatus } from "expo-audio";

function buildWav(frequency: number, durationMs: number): string {
  const sampleRate = 44100;
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const dataLen = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);

  const str4 = (offset: number, s: string) => {
    for (let i = 0; i < 4; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };

  str4(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  str4(8, "WAVE");
  str4(12, "fmt ");
  v.setUint32(16, 16, true); // subchunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str4(36, "data");
  v.setUint32(40, dataLen, true);

  for (let i = 0; i < numSamples; i++) {
    // short attack + release envelope to avoid clicking
    const env = Math.min(i / 80, 1) * Math.min((numSamples - i) / 80, 1);
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * env * 0.45 * 32767;
    v.setInt16(44 + i * 2, Math.round(sample), true);
  }

  const u8 = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  return btoa(bin);
}

async function playTone(frequency: number, durationMs: number): Promise<void> {
  const base64 = buildWav(frequency, durationMs);
  const uri = `${FileSystem.cacheDirectory}beep_${frequency}.wav`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return new Promise<void>((resolve) => {
    const player = createAudioPlayer({ uri });
    const sub = player.addListener("playbackStatusUpdate", (s: AudioStatus) => {
      if (s.didJustFinish) {
        sub.remove();
        player.remove();
        resolve();
      }
    });
    player.play();
  });
}

// High short beep — recording started
export function playStartBeep(): void {
  playTone(880, 80).catch(() => {});
}

// Lower short beep — recording stopped
export function playStopBeep(): void {
  playTone(440, 100).catch(() => {});
}
