import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Picker } from "@react-native-picker/picker";

import { PERSONAS, type PersonaKey } from "../constants/personas.js";
import {
  getApiKeys,
  getPersona,
  saveApiKeys,
  savePersona,
  getPlaybackSpeed,
  savePlaybackSpeed,
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
} from "../services/settingsStore.js";

export function SettingsScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";

  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<PersonaKey>("general");
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1.0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const [keys, persona, speed] = await Promise.all([
        getApiKeys(),
        getPersona(),
        getPlaybackSpeed(),
      ]);
      setOpenaiKey(keys.openaiKey);
      setAnthropicKey(keys.anthropicKey);
      setElevenLabsKey(keys.elevenLabsKey);
      setSelectedPersona(persona);
      setPlaybackSpeed(speed);
    }
    load();
  }, []);

  const handleSave = useCallback(async () => {
    if (!openaiKey.trim() || !anthropicKey.trim() || !elevenLabsKey.trim()) {
      Alert.alert("Missing keys", "Please fill in all three API keys.");
      return;
    }
    await Promise.all([
      saveApiKeys({
        openaiKey: openaiKey.trim(),
        anthropicKey: anthropicKey.trim(),
        elevenLabsKey: elevenLabsKey.trim(),
      }),
      savePersona(selectedPersona),
      savePlaybackSpeed(playbackSpeed),
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [openaiKey, anthropicKey, elevenLabsKey, selectedPersona, playbackSpeed]);

  const bg = isDark ? "#0a0a0a" : "#ffffff";
  const cardBg = isDark ? "#1a1a1a" : "#f5f5f5";
  const textColor = isDark ? "#ffffff" : "#000000";
  const subtleText = isDark ? "#888888" : "#666666";
  const inputBg = isDark ? "#111111" : "#f0f0f0";
  const borderColor = isDark ? "#333333" : "#e0e0e0";

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.section, { color: subtleText }]}>API KEYS</Text>

        {(
          [
            {
              label: "OpenAI API Key",
              hint: "Used for speech recognition (Whisper)",
              value: openaiKey,
              setter: setOpenaiKey,
            },
            {
              label: "Anthropic API Key",
              hint: "Used for Claude AI responses",
              value: anthropicKey,
              setter: setAnthropicKey,
            },
            {
              label: "ElevenLabs API Key",
              hint: "Used for text-to-speech",
              value: elevenLabsKey,
              setter: setElevenLabsKey,
            },
          ] as const
        ).map(({ label, hint, value, setter }) => (
          <View key={label} style={styles.field}>
            <Text style={[styles.label, { color: textColor }]}>{label}</Text>
            <Text style={[styles.hint, { color: subtleText }]}>{hint}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
              value={value}
              onChangeText={setter}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="sk-..."
              placeholderTextColor={subtleText}
            />
          </View>
        ))}

        <Text style={[styles.section, { color: subtleText, marginTop: 24 }]}>PERSONA</Text>

        {PERSONAS.map((p) => {
          const isSelected = selectedPersona === p.key;
          return (
            <TouchableOpacity
              key={p.key}
              style={[
                styles.personaCard,
                { backgroundColor: cardBg, borderColor },
                isSelected && styles.personaCardActive,
              ]}
              onPress={() => setSelectedPersona(p.key)}
              activeOpacity={0.7}
            >
              <View style={styles.personaRow}>
                <Text style={[styles.personaLabel, { color: textColor }]}>{p.label}</Text>
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={[styles.personaDesc, { color: subtleText }]}>{p.description}</Text>
            </TouchableOpacity>
          );
        })}

        <Text style={[styles.section, { color: subtleText, marginTop: 24 }]}>PLAYBACK SPEED</Text>
        <View style={[styles.pickerWrapper, { backgroundColor: cardBg, borderColor }]}>
          <Picker
            selectedValue={playbackSpeed}
            onValueChange={(v) => setPlaybackSpeed(v as PlaybackSpeed)}
            style={[styles.picker, { color: textColor }]}
            dropdownIconColor={textColor}
          >
            {PLAYBACK_SPEEDS.map((s) => (
              <Picker.Item key={s} label={`${s}x`} value={s} color={textColor} />
            ))}
          </Picker>
        </View>

        <TouchableOpacity
          style={[styles.saveButton, saved && styles.saveButtonDone]}
          onPress={handleSave}
          activeOpacity={0.8}
        >
          <Text style={styles.saveButtonText}>{saved ? "Saved ✓" : "Save"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40 },
  section: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1,
    marginBottom: 12,
  },
  field: { marginBottom: 20 },
  label: { fontSize: 15, fontWeight: "500", marginBottom: 2 },
  hint: { fontSize: 12, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "monospace",
  },
  personaCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  personaCardActive: {
    borderColor: "#6366f1",
    borderWidth: 2,
  },
  personaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  personaLabel: { fontSize: 15, fontWeight: "600" },
  personaDesc: { fontSize: 13, lineHeight: 18 },
  checkmark: { fontSize: 16, color: "#6366f1" },
  pickerWrapper: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 8,
    overflow: "hidden",
  },
  picker: {
    width: "100%",
  },
  saveButton: {
    backgroundColor: "#6366f1",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  saveButtonDone: { backgroundColor: "#22c55e" },
  saveButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
