import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useColorScheme } from "react-native";

import { HomeScreen } from "../screens/HomeScreen.js";
import { SettingsScreen } from "../screens/SettingsScreen.js";
import { SessionListScreen } from "../screens/SessionListScreen.js";
import { SessionDetailScreen } from "../screens/SessionDetailScreen.js";

export type RootStackParamList = {
  Home: undefined;
  Settings: undefined;
  Sessions: undefined;
  SessionDetail: { sessionId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: isDark ? "#0a0a0a" : "#ffffff" },
          headerTintColor: isDark ? "#ffffff" : "#000000",
          headerShadowVisible: false,
          contentStyle: { backgroundColor: isDark ? "#0a0a0a" : "#ffffff" },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
        <Stack.Screen
          name="Sessions"
          component={SessionListScreen}
          options={{ title: "Sessions" }}
        />
        <Stack.Screen
          name="SessionDetail"
          component={SessionDetailScreen}
          options={{ title: "Session" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
