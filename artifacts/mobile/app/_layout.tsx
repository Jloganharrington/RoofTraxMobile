import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CompanyGateScreen } from '@/components/CompanyGateScreen';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useOutboxSync } from '@/lib/outbox/useOutboxSync';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, View } from 'react-native';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <CompanyGateScreen />;
  }

  return <AuthenticatedStack />;
}

function AuthenticatedStack() {
  // Only runs once the session is authenticated — the outbox drainer needs
  // an authenticated API client to sync queued inspection writes.
  useOutboxSync();

  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="map" options={{ title: 'Add Pins' }} />
      <Stack.Screen
        name="pin-new"
        options={{ presentation: 'modal', title: 'New Pin' }}
      />
      <Stack.Screen
        name="bulk-upload"
        options={{ presentation: 'modal', title: 'Bulk Upload' }}
      />
      <Stack.Screen
        name="inspection-photo-capture"
        options={{ presentation: 'modal', title: 'Evidence Photos' }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <AuthProvider>
                <AuthGate />
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
