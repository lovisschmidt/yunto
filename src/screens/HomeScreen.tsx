import React, { useCallback, useEffect, useRef } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { WaveformAnimation } from "../components/WaveformAnimation.js";
import { usePipeline } from "../services/pipeline.js";
import type { RootStackParamList } from "../navigation/AppNavigator.js";
import HeadphoneButtonModule from "../../modules/headphone-button/index.js";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

const STATUS_LABELS: Record<string, string> = {
  idle: "Tap or press headphone button",
  recording: "Listening... (tap to stop)",
  processing: "Transcribing...",
  thinking: "Thinking...",
  speaking: "Speaking...",
};

export function HomeScreen({ navigation }: Props) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const {
    status,
    keysPresent,
    errorMessage,
    responsePreview,
    handleSinglePress,
    handleDoublePress,
    startNewSession,
    refreshApiKeyStatus,
  } = usePipeline();

  useFocusEffect(
    useCallback(() => {
      refreshApiKeyStatus();
    }, [refreshApiKeyStatus]),
  );

  // Stable refs so the event listener always calls the latest handler
  const singlePressRef = useRef(handleSinglePress);
  const doublePressRef = useRef(handleDoublePress);
  useEffect(() => {
    singlePressRef.current = handleSinglePress;
  }, [handleSinglePress]);
  useEffect(() => {
    doublePressRef.current = handleDoublePress;
  }, [handleDoublePress]);

  // Headphone button wiring (Android only)
  useEffect(() => {
    if (Platform.OS !== "android") return;
    HeadphoneButtonModule.startListening();
    const subscription = HeadphoneButtonModule.addListener("onButtonEvent", (event) => {
      if (event.type === "single") {
        singlePressRef.current();
      } else if (event.type === "double") {
        doublePressRef.current();
      }
    });
    return () => {
      subscription.remove();
      HeadphoneButtonModule.stopListening();
    };
  }, []);

  const onCenterPress = useCallback(() => {
    if (!keysPresent) return;
    handleSinglePress();
  }, [keysPresent, handleSinglePress]);

  const statusLabel = !keysPresent
    ? "Add your API keys in Settings to get started"
    : (STATUS_LABELS[status] ?? "");

  return (
    <SafeAreaView style={[styles.root, isDark && styles.rootDark]}>
      <TouchableOpacity
        style={styles.centerZone}
        onPress={onCenterPress}
        activeOpacity={0.8}
        disabled={!keysPresent}
      >
        <WaveformAnimation status={status} />
        <Text style={[styles.statusText, isDark && styles.textDark]}>{statusLabel}</Text>
        {responsePreview ? (
          <Text style={[styles.previewText, isDark && styles.previewTextDark]}>
            {responsePreview}
          </Text>
        ) : null}
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
      </TouchableOpacity>

      <View style={styles.bottomRow}>
        <TouchableOpacity onPress={() => navigation.navigate("Sessions")}>
          <Text style={[styles.navButton, isDark && styles.textDark]}>Sessions</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={startNewSession}>
          <Text style={[styles.navButton, isDark && styles.textDark]}>New Session</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate("Settings")}>
          <Text style={[styles.navButton, isDark && styles.textDark]}>Settings</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  rootDark: {
    backgroundColor: "#0a0a0a",
  },
  centerZone: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
  },
  statusText: {
    fontSize: 16,
    color: "#555555",
    textAlign: "center",
    paddingHorizontal: 32,
  },
  textDark: {
    color: "#aaaaaa",
  },
  bottomRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  navButton: {
    fontSize: 14,
    color: "#6366f1",
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  previewText: {
    fontSize: 14,
    color: "#333333",
    textAlign: "center",
    paddingHorizontal: 32,
    fontStyle: "italic",
  },
  previewTextDark: {
    color: "#cccccc",
  },
  errorText: {
    fontSize: 13,
    color: "#e53935",
    textAlign: "center",
    paddingHorizontal: 32,
  },
});
