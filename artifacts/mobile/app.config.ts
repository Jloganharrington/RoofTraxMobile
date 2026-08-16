import type { ExpoConfig, ConfigContext } from '@expo/config';

/**
 * Dynamic Expo config.
 *
 * ── EAS Project ID ──────────────────────────────────────────────────────────
 * Not a secret — it is a public project identifier. Replace the placeholder
 * below with the UUID printed by `eas init` (run once in artifacts/mobile/).
 * The same UUID applies to all build profiles (development / preview /
 * production); there is no per-environment variation.
 *
 * ── EXPO_PUBLIC_DOMAIN ──────────────────────────────────────────────────────
 * Set this per environment in EAS Environment Variables (NOT Replit Secrets —
 * EAS workers never see Replit Secrets):
 *
 *   eas env:create --name EXPO_PUBLIC_DOMAIN \
 *     --value <your-domain> \
 *     --environment production \
 *     --type string
 *
 * Repeat for the "preview" environment if you want preview builds to target a
 * staging deployment. Local development picks up the value from the dev script
 * in package.json (EXPO_PUBLIC_DOMAIN=$REPLIT_DEV_DOMAIN).
 *
 * See BUILD.md for the full pre-flight checklist.
 */

// ── EAS project UUID — fill in after running `eas init` ────────────────────
// Not a secret; safe to commit. Used by all build profiles.
const EAS_PROJECT_ID = 'REPLACE_AFTER_EAS_INIT';

// ── Runtime environment ──────────────────────────────────────────────────────
// EAS workers inject EAS_BUILD_PROFILE (e.g. "development", "preview",
// "production"). It is undefined during local `expo start` runs.
const easProfile = process.env.EAS_BUILD_PROFILE as string | undefined;
const domain = process.env.EXPO_PUBLIC_DOMAIN ?? '';

// ── Pre-flight guards (fail at config-evaluation, not at runtime) ────────────
if (easProfile) {
  // Any EAS build requires a real project UUID.
  if (EAS_PROJECT_ID === 'REPLACE_AFTER_EAS_INIT') {
    throw new Error(
      '[app.config.ts] EAS_PROJECT_ID placeholder has not been replaced.\n' +
      'Run `eas init` inside artifacts/mobile/ and paste the UUID into app.config.ts.',
    );
  }
  // Any EAS build requires a deployment domain so the router origin and API
  // base URL are valid.
  if (!domain) {
    throw new Error(
      `[app.config.ts] EXPO_PUBLIC_DOMAIN is required for "${easProfile}" builds.\n` +
      `Run: eas env:create --name EXPO_PUBLIC_DOMAIN --value <your-domain> --environment ${easProfile} --type string`,
    );
  }
}

// ── expo-router plugin — omit origin in local dev (Expo CLI infers it) ───────
// Emitting `origin: "https://"` when the domain is empty produces an invalid
// universal-link config; skip the option entirely when domain is absent.
const routerPlugin: NonNullable<ExpoConfig['plugins']>[number] = domain
  ? ['expo-router', { origin: `https://${domain}` }]
  : 'expo-router';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,

  name: 'RoofTrax',
  slug: 'mobile',
  version: '1.0.0',
  orientation: 'portrait',

  // "rooftrax" gives us rooftrax:// deep-links instead of the generic "mobile" slug.
  scheme: 'rooftrax',

  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,

  splash: {
    image: './assets/images/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.rooftrax.mobile',
  },

  android: {
    package: 'com.rooftrax.mobile',
  },

  web: {
    favicon: './assets/images/icon.png',
  },

  plugins: [
    routerPlugin,
    'expo-font',
    'expo-web-browser',
    [
      'expo-image-picker',
      {
        cameraPermission: 'RoofTrax uses the camera to capture inspection and evidence photos.',
        photosPermission: 'RoofTrax accesses your photo library to attach inspection images.',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'RoofTrax uses your location to GPS-stamp inspection photos and dropped pins.',
        locationAlwaysAndWhenInUsePermission:
          'RoofTrax uses your location to GPS-stamp inspection photos and dropped pins.',
      },
    ],
    'expo-mail-composer',
    [
      'expo-notifications',
      {
        icon: './assets/images/icon.png',
        color: '#1e3a5f',
        defaultChannel: 'default',
      },
    ],
  ],

  extra: {
    eas: {
      // Baked in from the constant above — applies to all build profiles.
      // Falls back gracefully in local dev (empty string); throws above when
      // it is still the placeholder during a real EAS build.
      projectId: EAS_PROJECT_ID === 'REPLACE_AFTER_EAS_INIT' ? '' : EAS_PROJECT_ID,
    },
  },

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});
