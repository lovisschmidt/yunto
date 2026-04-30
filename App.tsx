import React, { useEffect } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AudioModule } from "expo-audio";

import { AppNavigator } from "./src/navigation/AppNavigator.js";
import { getPermissionsRequested, setPermissionsRequested } from "./src/services/settingsStore.js";

export default function App() {
  useEffect(() => {
    async function requestPermissionsOnce() {
      if (Platform.OS !== "android") return;
      const already = await getPermissionsRequested();
      if (already) return;
      await AudioModule.requestRecordingPermissionsAsync();
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
      <AppNavigator />
    </SafeAreaProvider>
  );
}
