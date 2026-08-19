import type { Pin } from '@workspace/api-client-react';

export type PinColorPalette = {
  pinOwner: string;
  pinOther: string;
  pinNoContact: string;
  pinCustomer: string;
  dnkPending: string;
  dnkNoVisibleDamage: string;
  dnkMailerCampaign: string;
};

/**
 * Resolve map color in a fixed priority order:
 * 1. Do Not Knock verification is actionable state and stays visible.
 * 2. Retail outcomes that apply to everyone override ownership.
 * 3. Ordinary pins communicate ownership only.
 */
export function pinColorFor(
  pin: Pick<Pin, 'userId' | 'doorKnockResult' | 'dnkVerificationStatus'>,
  viewerUserId: string | undefined,
  colors: PinColorPalette,
): string {
  if (pin.dnkVerificationStatus === 'pending') return colors.dnkPending;
  if (pin.dnkVerificationStatus === 'no_visible_damage') return colors.dnkNoVisibleDamage;
  if (pin.dnkVerificationStatus === 'mailer_campaign') return colors.dnkMailerCampaign;
  if (pin.doorKnockResult === 'do_not_knock') return colors.dnkNoVisibleDamage;
  if (
    pin.doorKnockResult === 'no_answer' ||
    pin.doorKnockResult === 'no_appointment'
  ) {
    return colors.pinNoContact;
  }
  if (pin.doorKnockResult === 'appointment') return colors.pinCustomer;
  return pin.userId === viewerUserId ? colors.pinOwner : colors.pinOther;
}