import React, { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { type Session, formatSessionTitle, listSessions } from "../services/sessionStore.js";
import type { RootStackParamList } from "../navigation/AppNavigator.js";

type Props = NativeStackScreenProps<RootStackParamList, "Sessions">;

export function SessionListScreen({ navigation }: Props) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const [sessions, setSessions] = useState<Session[]>([]);

  const load = useCallback(async () => {
    const all = await listSessions();
    setSessions(all);
  }, []);

  useEffect(() => {
    load();
    const unsub = navigation.addListener("focus", load);
    return unsub;
  }, [load, navigation]);

  const bg = isDark ? "#0a0a0a" : "#ffffff";
  const textColor = isDark ? "#ffffff" : "#000000";
  const subtleText = isDark ? "#888888" : "#666666";
  const borderColor = isDark ? "#222222" : "#eeeeee";

  const renderItem = useCallback(
    ({ item }: { item: Session }) => (
      <TouchableOpacity
        style={[styles.row, { borderBottomColor: borderColor }]}
        onPress={() => navigation.navigate("SessionDetail", { sessionId: item.id })}
        activeOpacity={0.7}
      >
        <Text style={[styles.title, { color: textColor }]}>
          {formatSessionTitle(item.startedAt)}
        </Text>
        <Text style={[styles.count, { color: subtleText }]}>
          {item.messages.length} message{item.messages.length !== 1 ? "s" : ""}
        </Text>
      </TouchableOpacity>
    ),
    [navigation, textColor, subtleText, borderColor],
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: subtleText }]}>No sessions yet.</Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 15, fontWeight: "500" },
  count: { fontSize: 13 },
  empty: { textAlign: "center", marginTop: 60, fontSize: 15 },
});
