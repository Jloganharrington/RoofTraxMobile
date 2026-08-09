/**
 * Push notification permission, token registration, and deregistration.
 *
 * Design contract:
 *   - Never crashes the app — every function is wrapped in try/catch.
 *   - Permission is never requested cold on launch. The Profile tab provides
 *     an explicit "Enable Notifications" button. Once granted, we register
 *     automatically on every login so token refreshes are handled silently.
 *   - registerPushToken() is a no-op if permission is not yet granted.
 *   - deregisterPushToken() runs before the auth token is deleted on logout.
 *
 * EAS / production setup required (see Step 5e docs):
 *   - app.json → extra.eas.projectId must be set to the EAS project UUID.
 *   - iOS: APNs key uploaded in EAS credentials (eas credentials).
 *   - Android: FCM service account JSON uploaded in EAS credentials.
 *   - Push does NOT work in Expo Go on SDK 54 — use an EAS development build.
 */

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getApiBaseUrl } from './api';
import { getToken } from './tokenStorage';

const AUTH_TOKEN_KEY = 'auth_session_token';

// ---------------------------------------------------------------------------
// SDK 54 / expo-notifications v57 type workaround
// ---------------------------------------------------------------------------
// NotificationPermissionsStatus extends PermissionResponse (from 'expo'), but
// the expo SDK 54 TS re-export of PermissionResponse omits `granted`,
// `canAskAgain`, and `status`.  The properties DO exist at runtime (confirmed
// by expo docs example: settings.granted || settings.ios?.status === ...).
// We cast to this local type so tsc is satisfied without runtime risk.
type PermStatus = {
  granted:      boolean;
  canAskAgain:  boolean;
  status:       'granted' | 'denied' | 'undetermined';
};
async function getPerms(): Promise<PermStatus> {
  return Notifications.getPermissionsAsync() as unknown as Promise<PermStatus>;
}
async function requestPerms(): Promise<PermStatus> {
  return Notifications.requestPermissionsAsync() as unknown as Promise<PermStatus>;
}

// Show banner + sound when a push arrives while the app is foregrounded.
// SDK 54 / expo-notifications v57 uses shouldShowBanner + shouldShowList.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   false,
  }),
});

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/**
 * Returns the current OS permission status without prompting.
 * Exposes 'undetermined' so the Profile UI can show an "Enable" button.
 */
export async function getCurrentPermissionStatus(): Promise<
  'granted' | 'denied' | 'undetermined'
> {
  if (Platform.OS === 'web') return 'denied';
  try {
    const perms = await getPerms();
    if (perms.granted)       return 'granted';
    if (perms.canAskAgain)   return 'undetermined';
    return 'denied';
  } catch {
    return 'undetermined';
  }
}

/**
 * Prompts the user for push permission if it has not been determined yet.
 * Returns true if permission ends up granted (including already-granted).
 * Returns false without prompting if the user has previously denied — OS
 * will not re-show the dialog; the user must go to Settings manually.
 */
export async function requestPushPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const existing = await getPerms();
    if (existing.granted)      return true;
    if (!existing.canAskAgain) return false; // Denied — can't re-prompt.
    const result = await requestPerms();
    return result.granted;
  } catch (err) {
    console.warn('[notifications] requestPushPermission failed:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Token registration / deregistration
// ---------------------------------------------------------------------------

/**
 * Registers the device's Expo push token with the server.
 * Silent no-op if:
 *   - running on web
 *   - permission is not granted (user hasn't opted in yet)
 *   - EAS project ID is not configured (getExpoPushTokenAsync will throw)
 *   - network is unavailable
 *
 * Safe to call on every login — the server upserts on conflict.
 */
export async function registerPushToken(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const perms = await getPerms();
    if (!perms.granted) return;

    // projectId is required on SDK 54+. Read from app.json → extra.eas.projectId
    // (set when the EAS project is initialised via `eas init`).
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId as string | undefined;

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoPushToken = tokenData.data; // "ExponentPushToken[...]"

    const apiBase  = getApiBaseUrl();
    const authToken = await getToken(AUTH_TOKEN_KEY);
    if (!authToken) return;

    await fetch(`${apiBase}/api/notifications/push-tokens`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        expoPushToken,
        platform:    Platform.OS as 'ios' | 'android',
        deviceLabel: await getDeviceName(),
      }),
    });
  } catch (err) {
    // Graceful — a failed registration only means no push; never a crash.
    console.warn('[notifications] registerPushToken failed:', err);
  }
}

/**
 * Deregisters the current device token from the server.
 * Must be called BEFORE the auth token is deleted on logout (it needs the
 * Bearer token to authenticate the DELETE request).
 * Silent no-op if permission is not granted or EAS is not configured.
 */
export async function deregisterPushToken(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const perms = await getPerms();
    if (!perms.granted) return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId as string | undefined;

    const tokenData    = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoPushToken = tokenData.data;

    const apiBase   = getApiBaseUrl();
    const authToken = await getToken(AUTH_TOKEN_KEY);
    if (!authToken) return;

    await fetch(
      `${apiBase}/api/notifications/push-tokens/${encodeURIComponent(expoPushToken)}`,
      {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );
  } catch (err) {
    // Graceful — missing deregister only means a stale token; never a crash.
    console.warn('[notifications] deregisterPushToken failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getDeviceName(): Promise<string> {
  // expo-device is not in this project; derive a label from the platform.
  return Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android device' : 'Device';
}
