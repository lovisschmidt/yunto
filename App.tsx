import React, { useEffect } from "react";
import { PermissionsAndroid, Platform, StatusBar, useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AudioModule } from "expo-audio";

import { AppNavigator } from "./src/navigation/AppNavigator.js";
import { getPermissionsRequested, setPermissionsRequested } from "./src/services/settingsStore.js";

export default function App() {
  const isDark = useColorScheme() === "dark";

  useEffect(() => {
    async function requestPermissionsOnce() {
      if (Platform.OS !== "android") return;
      const already = await getPermissionsRequested();
      if (already) return;
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) return;
      // POST_NOTIFICATIONS required for foreground service notification on Android 13+
      if (Platform.Version >= 33) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
      await setPermissionsRequested();
    }
    requestPermissionsOnce();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        backgroundColor="transparent"
        translucent
      />
      <AppNavigator />
    </SafeAreaProvider>
  );
}
