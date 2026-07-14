import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';

// Placeholder landing spot for the forensic inspection module. Gated to the
// inspector_canvasser department (and super_admin) in _layout.tsx. The
// actual capture/measurement workflow ships in a later phase — this tab
// just proves the department-based routing gate works today.
export default function InspectionsScreen() {
  const colors = useColors();

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Icon name="clipboard" size={40} color={colors.mutedForeground} />
      <Text style={[styles.title, { color: colors.foreground }]}>Inspections</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        The forensic inspection workflow is coming soon.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    paddingTop: Platform.OS === 'web' ? 32 : 0,
  },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 14, textAlign: 'center' },
});
