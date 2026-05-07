import * as SecureStore from "expo-secure-store";
import { DEFAULT_PERSONA, PersonaKey } from "../constants/personas.js";

const KEYS = {
  openaiKey: "openai_api_key",
  anthropicKey: "anthropic_api_key",
  elevenLabsKey: "elevenlabs_api_key",
  persona: "persona",
  playbackSpeed: "playback_speed",
  permissionsRequested: "permissions_requested",
} as const;

export const PLAYBACK_SPEEDS = [0.5, 1.0, 1.5, 2.0] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 1.0;

export interface ApiKeys {
  openaiKey: string;
  anthropicKey: string;
  elevenLabsKey: string;
}

export async function getApiKeys(): Promise<ApiKeys> {
  const [openaiKey, anthropicKey, elevenLabsKey] = await Promise.all([
    SecureStore.getItemAsync(KEYS.openaiKey),
    SecureStore.getItemAsync(KEYS.anthropicKey),
    SecureStore.getItemAsync(KEYS.elevenLabsKey),
  ]);
  return {
    openaiKey: openaiKey ?? "",
    anthropicKey: anthropicKey ?? "",
    elevenLabsKey: elevenLabsKey ?? "",
  };
}

export async function saveApiKeys(keys: ApiKeys): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.openaiKey, keys.openaiKey),
    SecureStore.setItemAsync(KEYS.anthropicKey, keys.anthropicKey),
    SecureStore.setItemAsync(KEYS.elevenLabsKey, keys.elevenLabsKey),
  ]);
}

export async function hasApiKeys(): Promise<boolean> {
  const keys = await getApiKeys();
  return !!(keys.openaiKey && keys.anthropicKey && keys.elevenLabsKey);
}

export async function getPersona(): Promise<PersonaKey> {
  const value = await SecureStore.getItemAsync(KEYS.persona);
  return (value as PersonaKey | null) ?? DEFAULT_PERSONA;
}

export async function savePersona(persona: PersonaKey): Promise<void> {
  await SecureStore.setItemAsync(KEYS.persona, persona);
}

export async function getPlaybackSpeed(): Promise<PlaybackSpeed> {
  const value = await SecureStore.getItemAsync(KEYS.playbackSpeed);
  const parsed = value ? parseFloat(value) : DEFAULT_PLAYBACK_SPEED;
  return (
    PLAYBACK_SPEEDS.includes(parsed as PlaybackSpeed) ? parsed : DEFAULT_PLAYBACK_SPEED
  ) as PlaybackSpeed;
}

export async function savePlaybackSpeed(speed: PlaybackSpeed): Promise<void> {
  await SecureStore.setItemAsync(KEYS.playbackSpeed, String(speed));
}

export async function getPermissionsRequested(): Promise<boolean> {
  const value = await SecureStore.getItemAsync(KEYS.permissionsRequested);
  return value === "true";
}

export async function setPermissionsRequested(): Promise<void> {
  await SecureStore.setItemAsync(KEYS.permissionsRequested, "true");
}
