import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { type Session, formatSessionTitle, listSessions } from "../services/sessionStore.js";
import type { RootStackParamList } from "../navigation/AppNavigator.js";

type Props = NativeStackScreenProps<RootStackParamList, "SessionDetail">;

export function SessionDetailScreen({ route, navigation }: Props) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const { sessionId } = route.params;
  const [session, setSession] = useState<Session | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      const all = await listSessions();
      const found = all.find((s) => s.id === sessionId) ?? null;
      setSession(found);
      if (found) {
        navigation.setOptions({ title: formatSessionTitle(found.startedAt) });
      }
    }
    load();
  }, [sessionId, navigation]);

  const copyAll = useCallback(() => {
    if (!session) return;
    const text = session.messages
      .map((m) => `${m.role === "user" ? "You" : "AI"}: ${m.content}`)
      .join("\n\n");
    Clipboard.setString(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [session]);

  const bg = isDark ? "#0a0a0a" : "#ffffff";
  const textColor = isDark ? "#ffffff" : "#000000";
  const subtleText = isDark ? "#888888" : "#666666";
  const userBubble = isDark ? "#1e293b" : "#e8eaf6";
  const aiBubble = isDark ? "#1a1a1a" : "#f5f5f5";

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={["bottom"]}>
      <TouchableOpacity style={styles.copyBtn} onPress={copyAll}>
        <Text style={[styles.copyText, copied && styles.copyDone]}>
          {copied ? "Copied ✓" : "Copy all"}
        </Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll}>
        {session?.messages.map((msg, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              msg.role === "user"
                ? [styles.bubbleUser, { backgroundColor: userBubble }]
                : [styles.bubbleAi, { backgroundColor: aiBubble }],
            ]}
          >
            <Text style={[styles.bubbleText, { color: textColor }]}>{msg.content}</Text>
            <Text style={[styles.ts, { color: subtleText }]}>
              {new Date(msg.timestamp).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  copyBtn: { alignItems: "flex-end", paddingHorizontal: 20, paddingVertical: 10 },
  copyText: { fontSize: 14, color: "#6366f1" },
  copyDone: { color: "#22c55e" },
  scroll: { padding: 16, gap: 12 },
  bubble: { borderRadius: 12, padding: 12, maxWidth: "85%" },
  bubbleUser: { alignSelf: "flex-end" },
  bubbleAi: { alignSelf: "flex-start" },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  ts: { fontSize: 11, marginTop: 4 },
});
