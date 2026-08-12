import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { Icon } from '@/components/Icon';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';

export default function TabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const { role, department, companyPpTier } = useProfile();
  // inspector_canvasser is the department built for the forensic inspection
  // module; super_admin can always reach it too. PP-only reps always get access
  // since inspections are their primary capture workflow.
  const isPpOnly = companyPpTier === 'pp_only';
  const canSeeInspections = department === 'inspector_canvasser' || role === 'super_admin' || isPpOnly;

  return (
    <Tabs
      screenOptions={{
        // Active = brand orange, inactive = muted slate. Both tokens are
        // legible on every tab-bar surface (white card on Android/web, light
        // or dark blur on iOS) — never hardcode white here: it disappears on
        // light backgrounds.
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: true,
        headerStyle: { backgroundColor: colors.secondary },
        headerTintColor: '#ffffff',
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.card,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.card },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <Icon name="home" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="change-orders"
        options={{
          title: 'Change Orders',
          tabBarIcon: ({ color }) => (
            <Icon name="file-text" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inspections"
        options={{
          title: 'Inspections',
          href: canSeeInspections ? undefined : null,
          tabBarIcon: ({ color }) => (
            <Icon name="clipboard" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: 'Documents',
          href: canSeeInspections ? undefined : null,
          tabBarIcon: ({ color }) => (
            <Icon name="folder" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <Icon name="user" size={22} color={color} />
          ),
        }}
      />
      {/* agreements.tsx is kept for deep-link compatibility but must not
          appear as a tab — it redirects to /documents. */}
      <Tabs.Screen
        name="agreements"
        options={{ href: null }}
      />
    </Tabs>
  );
}
