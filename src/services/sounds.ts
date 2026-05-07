import * as FileSystem from "expo-file-system/legacy";
import { createAudioPlayer } from "expo-audio";
import type { AudioPlayer, AudioStatus } from "expo-audio";

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
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str4(36, "data");
  v.setUint32(40, dataLen, true);

  for (let i = 0; i < numSamples; i++) {
    const env = Math.min(i / 80, 1) * Math.min((numSamples - i) / 80, 1);
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * env * 0.45 * 32767;
    v.setInt16(44 + i * 2, Math.round(sample), true);
  }

  const u8 = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  return btoa(bin);
}

async function writeBeep(frequency: number, durationMs: number): Promise<string> {
  const uri = `${FileSystem.cacheDirectory}beep_${frequency}.wav`;
  await FileSystem.writeAsStringAsync(uri, buildWav(frequency, durationMs), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

type Beep = { player: AudioPlayer };

const beeps: { start: Beep | null; stop: Beep | null; thinking: Beep | null } = {
  start: null,
  stop: null,
  thinking: null,
};

function waitForLoad(player: AudioPlayer): Promise<void> {
  return new Promise((resolve) => {
    if (player.isLoaded) {
      resolve();
      return;
    }
    const sub = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
      if (status.isLoaded) {
        sub.remove();
        resolve();
      }
    });
  });
}

// Called from pipeline after setAudioModeAsync so players inherit the correct audio mode.
// Must be awaited — createAudioPlayer loads asynchronously, and play() silently no-ops
// until isLoaded is true, causing the first beep to be missed.
export async function initBeeps(): Promise<void> {
  const [uriStart, uriStop, uriThinking] = await Promise.all([
    writeBeep(880, 80),
    writeBeep(440, 100),
    writeBeep(660, 60),
  ]);
  const pStart = createAudioPlayer({ uri: uriStart });
  const pStop = createAudioPlayer({ uri: uriStop });
  const pThinking = createAudioPlayer({ uri: uriThinking });
  await Promise.all([waitForLoad(pStart), waitForLoad(pStop), waitForLoad(pThinking)]);
  beeps.start = { player: pStart };
  beeps.stop = { player: pStop };
  beeps.thinking = { player: pThinking };
}

function fireBeep(beep: Beep | null): void {
  if (!beep) return;
  beep.player.seekTo(0);
  beep.player.play();
}

export function playStartBeep(): void {
  fireBeep(beeps.start);
}

export function playStopBeep(): void {
  fireBeep(beeps.stop);
}

export function playThinkingTone(): void {
  fireBeep(beeps.thinking);
}
