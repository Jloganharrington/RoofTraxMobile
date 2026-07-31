import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BugReportButton } from '@/components/BugReportButton';
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
    <View style={{ flex: 1 }}>
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
      <Stack.Screen name="inspection-start" options={{ title: 'Start Inspection' }} />
      <Stack.Screen
        name="inspection-preliminary-intake"
        options={{ title: 'Preliminary Intake' }}
      />
      <Stack.Screen
        name="inspection-preliminary-photos"
        options={{ title: 'Phase 1 Photos' }}
      />
      <Stack.Screen name="inspection-report" options={{ title: 'Homeowner Report' }} />
      <Stack.Screen name="inspection-intake" options={{ title: 'Claim Intake' }} />
      <Stack.Screen name="inspection/[id]" options={{ title: 'Inspection' }} />
      <Stack.Screen name="inspection-storm" options={{ title: 'Confirm Storm' }} />
      <Stack.Screen name="inspection-arrival" options={{ title: 'Log Arrival' }} />
      <Stack.Screen name="inspection-elevations" options={{ title: 'Elevations & Access' }} />
      <Stack.Screen name="inspection-roof" options={{ title: 'Roof Inspection' }} />
      <Stack.Screen name="inspection-test-squares" options={{ title: 'Test Squares' }} />
      <Stack.Screen name="inspection-collateral" options={{ title: 'Collateral & Ground' }} />
      <Stack.Screen name="inspection-components" options={{ title: 'Components' }} />
      <Stack.Screen name="inspection-product" options={{ title: 'Product ID' }} />
      <Stack.Screen name="inspection-facet" options={{ title: 'Facet Detail' }} />
      <Stack.Screen name="inspection-measurements-confirm" options={{ title: 'Review Measurements' }} />
      <Stack.Screen name="inspection-siding" options={{ title: 'Siding Inspection' }} />
      <Stack.Screen name="inspection-siding-facet" options={{ title: 'Siding Facet' }} />
      <Stack.Screen name="inspection-interior" options={{ title: 'Interior / Attic' }} />
      <Stack.Screen name="inspection-homeowner" options={{ title: 'Homeowner' }} />
      <Stack.Screen name="inspection-estimate" options={{ title: 'Estimate' }} />
      <Stack.Screen name="inspection-readiness" options={{ title: 'Readiness' }} />
      <Stack.Screen name="inspection-declaration" options={{ title: 'Declaration' }} />
      <Stack.Screen name="bug-reports" options={{ title: 'Bug Reports' }} />
      <Stack.Screen name="inspection-agreement" options={{ title: 'Get Homeowner Signature' }} />
      <Stack.Screen name="proof-package-settings" options={{ title: 'Proof Package Settings' }} />
    </Stack>
    {/* Beta bug-report pill: mounted ONCE here (never per-screen), renders
        above every authenticated screen, hidden on login by construction
        (this component only exists inside the authenticated stack). Gated on
        the company betaBugReporting flag internally. */}
    <BugReportButton />
    </View>
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
