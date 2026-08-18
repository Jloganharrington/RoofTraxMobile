import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useColors } from '@/hooks/useColors';
import { Icon } from '@/components/Icon';

const UPGRADE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/axiomrestore-web/pp/upgrade`
  : 'https://axiomrestore.com/pp/upgrade';

interface UpgradeRequiredScreenProps {
  /** Optional feature name displayed in the message, e.g. "the Pipeline Board". */
  featureName?: string;
}

/**
 * Shown in place of CRM-gated screens when the user's company is on the
 * PP-only plan. Gives them a friendly prompt and a one-tap path to upgrade.
 */
export function UpgradeRequiredScreen({ featureName }: UpgradeRequiredScreenProps) {
  const colors = useColors();

  const handleUpgrade = async () => {
    await WebBrowser.openBrowserAsync(UPGRADE_URL, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Icon name="shield" size={32} color={colors.primary} />
      </View>

      <Text style={[styles.title, { color: colors.foreground }]}>
        Full CRM Required
      </Text>

      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        {featureName
          ? `${featureName} is part of the full AxiomRestore CRM.`
          : 'This feature is part of the full AxiomRestore CRM.'}
        {'\n\n'}
        Upgrade your plan to unlock pipeline management, lead tracking, team maps, commission
        reports, and more.
      </Text>

      <Pressable
        onPress={handleUpgrade}
        style={[styles.button, { backgroundColor: colors.primary }]}
      >
        <Icon name="arrow-right" size={16} color={colors.primaryForeground} />
        <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
          Upgrade to Full CRM
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
