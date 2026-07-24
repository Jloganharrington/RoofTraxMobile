import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

// Preset damage classification labels for photo evidence. These map to the
// six standard categories used in the forensic report's photo evidence sections.
export const DAMAGE_CAPTIONS = [
  { label: 'Wind – Missing', short: 'Missing' },
  { label: 'Wind – Creased', short: 'Creased' },
  { label: 'Wind – Mat Transfer', short: 'Mat Transfer' },
  { label: 'Wind – Nail Pull Through', short: 'Nail Pull' },
  { label: 'Hail Damage', short: 'Hail' },
  { label: 'Excluded – Blistering/WT/Other', short: 'Excluded' },
] as const;

export type DamageCaption = (typeof DAMAGE_CAPTIONS)[number]['label'];

interface DamageCaptionChipsProps {
  /** Currently active caption label, or null if none selected. */
  value: string | null;
  /** Called with the new caption on tap; null means deselect (clear). */
  onChange: (caption: string | null) => void;
  /** Shows a saving spinner and disables all chips while true. */
  saving?: boolean;
}

/**
 * Quick-select chip row for photo damage classification. One chip at a time;
 * tapping the active chip deselects it (clears the caption).
 */
export function DamageCaptionChips({ value, onChange, saving }: DamageCaptionChipsProps) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      {DAMAGE_CAPTIONS.map((opt) => {
        const active = value === opt.label;
        return (
          <Pressable
            key={opt.label}
            onPress={() => onChange(active ? null : opt.label)}
            disabled={saving}
            style={[
              styles.chip,
              {
                backgroundColor: active ? colors.primary : colors.card,
                borderColor: active ? colors.primary : colors.border,
                opacity: saving ? 0.6 : 1,
              },
            ]}
          >
            <Text
              style={{
                color: active ? colors.primaryForeground : colors.foreground,
                fontSize: 12,
                fontWeight: '600',
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
      {saving && (
        <ActivityIndicator size="small" color={colors.mutedForeground} style={{ marginLeft: 4 }} />
      )}
    </View>
  );
}

/**
 * Small inline badge showing the short form of the selected caption label.
 * Renders nothing when caption is null/undefined.
 */
export function DamageCaptionBadge({ caption }: { caption: string | null | undefined }) {
  const colors = useColors();
  if (!caption) return null;
  const match = DAMAGE_CAPTIONS.find((c) => c.label === caption);
  const text = match?.short ?? caption;
  return (
    <View style={[styles.badge, { backgroundColor: colors.primary }]}>
      <Text style={{ color: colors.primaryForeground, fontSize: 10, fontWeight: '700' }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
});
