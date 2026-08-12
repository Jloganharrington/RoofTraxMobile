/**
 * Trial-flow outbound email (spec §7).
 *
 * Trial recipients are external contractors — NOT tenant users — so the
 * per-user SMTP path in notify.ts does not apply. This mailer uses a
 * system-level SMTP transport configured via env vars:
 *   TRIAL_SMTP_HOST, TRIAL_SMTP_PORT, TRIAL_SMTP_USER, TRIAL_SMTP_PASS,
 *   TRIAL_SMTP_FROM
 * When unconfigured, emails are logged (subject + recipient) so the flow
 * still works end-to-end in development.
 *
 * COPY RULES (spec §3): no claim approval rates, no recovery/settlement
 * amounts, no "get your claim paid", no implication of influence over a
 * carrier's coverage determination. Documentation quality/speed only.
 */
import nodemailer from 'nodemailer';
import { logger } from '../logger';
import { trialConfig } from './config';

function transport() {
  const host = process.env.TRIAL_SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.TRIAL_SMTP_PORT || '587', 10),
    secure: process.env.TRIAL_SMTP_PORT === '465',
    auth: process.env.TRIAL_SMTP_USER
      ? { user: process.env.TRIAL_SMTP_USER, pass: process.env.TRIAL_SMTP_PASS }
      : undefined,
  });
}

export async function sendTrialEmail(to: string, subject: string, text: string): Promise<void> {
  const t = transport();
  if (!t) {
    logger.info({ to, subject }, 'trial email (SMTP not configured — logged only)');
    logger.debug({ text }, 'trial email body');
    return;
  }
  try {
    await t.sendMail({ from: process.env.TRIAL_SMTP_FROM || process.env.TRIAL_SMTP_USER, to, subject, text });
  } catch (err) {
    logger.error({ err, to, subject }, 'trial email send failed');
  }
}

const SIGNOFF = '\n\n— The RoofTrax Team';

export const trialEmails = {
  verify(link: string) {
    return {
      subject: 'Verify your email — RoofTrax Proof Package',
      text: `Confirm your company email to continue your proof package submission:\n\n${link}\n\nIf you didn't request this, you can ignore this email.${SIGNOFF}`,
    };
  },
  paymentReceipt(amountCents: number, expectedDate: string) {
    return {
      subject: 'Receipt — your proof package is in the review queue',
      text: `We received your payment of $${(amountCents / 100).toFixed(2)}.\n\nWhat happens next:\n1. Our team reviews your submission (licensing, jurisdiction coverage, photo set).\n2. Once approved, we build your jurisdiction's code packet and your proof package.\n3. Expect your package about ${trialConfig.turnaroundBusinessDays} business days after approval — currently estimated ${expectedDate}.\n\nWe'll email you at each step.${SIGNOFF}`,
    };
  },
  approved(expectedDate: string) {
    return {
      subject: "We're building your proof package",
      text: `Your submission passed review and is now in production.\n\nWe're compiling every applicable code and amendment for your county, then assembling your branded proof package. Expected ready date: ${expectedDate}.${SIGNOFF}`,
    };
  },
  rejected(reason: string, refundNote: string) {
    return {
      subject: 'About your proof package submission',
      text: `We weren't able to move forward with this submission.\n\nReason: ${reason}\n\n${refundNote}\n\nClaim details from this submission will be removed from our systems within ${trialConfig.rejectedPurgeAfterDays} days.${SIGNOFF}`,
    };
  },
  ready(bookingLink: string) {
    // Deliberate conversion mechanic: booking link ONLY — package is NOT attached.
    return {
      subject: 'Your proof package is ready — book your walkthrough',
      text: `Your proof package is complete.\n\nWe deliver it on a 30-minute walkthrough call so we can take you through the code citations, the exhibit structure, and how to put it to work. Grab a time here:\n\n${bookingLink || '(booking link not configured)'}\n\nYou'll receive the package right after the call.${SIGNOFF}`,
    };
  },
  deliverable(link: string) {
    return {
      subject: 'Your proof package',
      text: `Thanks for taking the walkthrough. Here's your proof package:\n\n${link}\n\nThis link expires in 30 days. Per our data policy, claim details from your submission are removed 30 days after delivery — the jurisdiction code research stays in our library and contains nothing about your claim.${SIGNOFF}`,
    };
  },
  checkIn(day: number, creditCents: number, creditExpires: string) {
    return {
      subject: 'How did the documentation hold up?',
      text: `It's been ${day} days since we delivered your proof package. We'd love to hear how the documentation worked for your process.\n\nReminder: you have $${(creditCents / 100).toFixed(2)} in credit toward an annual RoofTrax plan (Crew and above), valid until ${creditExpires}.${SIGNOFF}`,
    };
  },
  creditExpiring(creditCents: number, daysLeft: number) {
    return {
      subject: `Your $${(creditCents / 100).toFixed(0)} credit expires in ${daysLeft} days`,
      text: `Your proof package credit of $${(creditCents / 100).toFixed(2)} applies toward any annual RoofTrax plan (Crew and above), within 90 days of your first trial submission. It expires in ${daysLeft} days.\n\nReply to this email or visit the pricing page to put it to work.${SIGNOFF}`,
    };
  },
};
