import React from 'react';
import { useProfile } from '@/hooks/useProfile';
import { UpgradeRequiredScreen } from '@/components/UpgradeRequiredScreen';
import DashboardScreen from '@/components/DashboardScreen';

/**
 * Home tab — shows the pin/leads board for CRM users, or an upgrade prompt
 * for PP-only subscribers (who don't have pipeline/CRM access).
 */
export default function HomeTab() {
  const { companyPpTier } = useProfile();

  if (companyPpTier === 'pp_only') {
    return <UpgradeRequiredScreen featureName="The leads board" />;
  }

  return <DashboardScreen />;
}
