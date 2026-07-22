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
  const { role, department } = useProfile();
  const canSeeTeam = role === 'manager' || role === 'admin' || role === 'super_admin';
  // inspector_canvasser is the department built for the forensic inspection
  // module; super_admin can always reach it too. Content ships in a later
  // phase — this tab currently just gates the placeholder screen.
  const canSeeInspections = department === 'inspector_canvasser' || role === 'super_admin';

  return (
    <Tabs
      screenOptions={{
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
        name="team"
        options={{
          title: 'Team',
          href: canSeeTeam ? undefined : null,
          tabBarIcon: ({ color }) => (
            <Icon name="users" size={22} color={color} />
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
    </Tabs>
  );
}
