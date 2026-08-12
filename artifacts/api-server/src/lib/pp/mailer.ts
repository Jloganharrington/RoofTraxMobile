/**
 * PP subscriber outbound email.
 *
 * Uses the same SMTP environment variables as the trial mailer:
 *   TRIAL_SMTP_HOST, TRIAL_SMTP_PORT, TRIAL_SMTP_USER, TRIAL_SMTP_PASS,
 *   TRIAL_SMTP_FROM
 * When unconfigured, emails are logged to stdout so the flow works in dev.
 */
import nodemailer from 'nodemailer';
import { logger } from '../logger';

function transport() {
  const host = process.env.TRIAL_SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.TRIAL_SMTP_PORT ?? '587', 10),
    secure: process.env.TRIAL_SMTP_PORT === '465',
    auth: process.env.TRIAL_SMTP_USER
      ? { user: process.env.TRIAL_SMTP_USER, pass: process.env.TRIAL_SMTP_PASS }
      : undefined,
  });
}

export async function sendPPEmail(to: string, subject: string, text: string): Promise<void> {
  const t = transport();
  if (!t) {
    logger.info({ to, subject }, 'pp email (SMTP not configured — logged only)');
    logger.debug({ text }, 'pp email body');
    return;
  }
  try {
    await t.sendMail({
      from: process.env.TRIAL_SMTP_FROM ?? process.env.TRIAL_SMTP_USER,
      to,
      subject,
      text,
    });
  } catch (err) {
    logger.error({ err, to, subject }, 'pp email send failed');
  }
}

const SIGNOFF = '\n\n— The RoofTrax Team';

export const ppEmails = {
  verify(link: string) {
    return {
      subject: 'Verify your email — RoofTrax Proof Package',
      text: `Welcome to RoofTrax Proof Package!\n\nPlease confirm your email address to activate your account:\n\n${link}\n\nThis link expires in 24 hours. If you didn't create an account, you can ignore this email.${SIGNOFF}`,
    };
  },

  welcome(companyName: string) {
    return {
      subject: 'Your RoofTrax Proof Package account is ready',
      text: `Hi,\n\nYour account for ${companyName} is set up and ready to use. Log in at any time to start compiling Proof Packages.\n\nIf you have questions, reply to this email.${SIGNOFF}`,
    };
  },

  passwordReset(link: string) {
    return {
      subject: 'Reset your RoofTrax password',
      text: `Someone requested a password reset for your RoofTrax Proof Package account.\n\nClick the link below to set a new password (expires in 1 hour):\n\n${link}\n\nIf you didn't request this, you can safely ignore this email.${SIGNOFF}`,
    };
  },
};
