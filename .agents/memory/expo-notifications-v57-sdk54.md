---
name: expo-notifications v57 (SDK 54) quirks
description: SDK 54 / expo-notifications v57 TypeScript and API changes that differ from docs and older SDK behaviour.
---

## TypeScript `PermissionResponse` type mismatch

`NotificationPermissionsStatus` extends `PermissionResponse` imported from `'expo'`.  In SDK 54, that re-export omits `granted`, `canAskAgain`, and `status` from the TypeScript types — even though all three exist at runtime (confirmed by the expo docs example: `settings.granted || settings.ios?.status === …`).

**Fix:** use a local cast helper so tsc is satisfied without runtime risk:

```typescript
type PermStatus = {
  granted: boolean;
  canAskAgain: boolean;
  status: 'granted' | 'denied' | 'undetermined';
};
async function getPerms(): Promise<PermStatus> {
  return Notifications.getPermissionsAsync() as unknown as Promise<PermStatus>;
}
async function requestPerms(): Promise<PermStatus> {
  return Notifications.requestPermissionsAsync() as unknown as Promise<PermStatus>;
}
```

**Why:** The `expo` package in SDK 54 re-exports `PermissionResponse` with a stripped type that TS resolves as missing those fields. This is a TS declaration inconsistency — not a real API change.

## `NotificationBehavior` shape changed

SDK 54 `setNotificationHandler` requires `shouldShowBanner` + `shouldShowList` instead of the legacy `shouldShowAlert`:

```typescript
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   false,
  }),
});
```

## Push token registration needs EAS project ID

`getExpoPushTokenAsync({ projectId })` requires the EAS project UUID from `app.json → extra.eas.projectId` (set via `eas init`). Without it the call throws — but wrap in try/catch so it's a silent no-op, not a crash.

**Push does NOT work in Expo Go on SDK 54.** An EAS development build is required for real device testing.

## Bundle identifiers required for push

`app.json` must have:
- `ios.bundleIdentifier` — must match the App ID in Apple Developer Portal where APNs is enabled.
- `android.package` — must match the Firebase project's package name.

Both set to `com.rooftrax.mobile` as placeholder; update when EAS project is initialised.

## EAS credential steps (operational, not code)

1. `eas init` — creates project UUID; paste into `app.json → extra.eas.projectId`.
2. `eas credentials` — upload APNs key (iOS) and FCM service-account JSON (Android).
3. `eas build --profile development --platform all` — creates installable dev build.
4. Distribute via EAS Update URL or QR code from `eas build:list`.
