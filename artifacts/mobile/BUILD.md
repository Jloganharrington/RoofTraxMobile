# AxiomRestore Mobile — Build & Submit Guide

This document covers the one-time setup required before the first EAS build
and the commands used for day-to-day builds and submissions.

---

## Prerequisites

| Tool | Install |
|------|---------|
| Node ≥ 20 | https://nodejs.org |
| EAS CLI | `npm install -g eas-cli` |
| Expo account | https://expo.dev — free |
| Apple Developer account | https://developer.apple.com — $99/yr |
| Google Play Console account | https://play.google.com/console — $25 one-time |

---

## One-time setup (do this once)

### 1. Create the EAS project and paste the UUID

```bash
cd artifacts/mobile
eas login          # sign in to your Expo account
eas init           # creates the project on expo.dev and prints a UUID
```

Open `artifacts/mobile/app.config.ts` and replace the placeholder:

```ts
// Before
const EAS_PROJECT_ID = 'REPLACE_AFTER_EAS_INIT';

// After
const EAS_PROJECT_ID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
```

The UUID is **not a secret** — it is safe to commit. It is the same value for
all build profiles (development, preview, production).

### 2. Store EXPO_PUBLIC_DOMAIN in EAS Environment Variables

> **EAS workers do not inherit Replit Secrets.** The deployment domain must be
> stored in **EAS Environment Variables** — managed by Expo, not Replit.

```bash
# Production builds → your live deployment domain
eas env:create \
  --name EXPO_PUBLIC_DOMAIN \
  --value <your-production-domain> \
  --environment production \
  --type string

# Preview builds → staging domain (or same as production if no staging)
eas env:create \
  --name EXPO_PUBLIC_DOMAIN \
  --value <your-staging-domain> \
  --environment preview \
  --type string
```

Development builds pick up `EXPO_PUBLIC_DOMAIN` from the `dev` script in
`package.json` (set to `$REPLIT_DEV_DOMAIN` automatically), so no EAS env var
is needed for the development profile.

Verify stored variables at any time:

```bash
eas env:list --environment production
eas env:list --environment preview
```

### 3. Configure store credentials

**iOS** — EAS provisions signing certificates automatically. When prompted on
the first build, choose "EAS manages credentials". Have your Apple ID and
team ID ready.

**Android** — EAS generates and securely stores a keystore on the first build.
No manual action required unless migrating an existing keystore.

---

## Build commands

```bash
# Development build — installs the Expo Dev Client binary on a device or
# simulator. After installation, open the Dev Client app and scan the QR code.
# (This is NOT Expo Go — you must install the custom dev client first.)
eas build --platform all --profile development

# Preview build — production JS bundle distributed internally via an EAS link.
# Use this for QA testing before submitting to the stores.
eas build --platform all --profile preview

# Production build — store-ready binary; auto-increments the build number.
eas build --platform all --profile production
```

Add `--platform ios` or `--platform android` to build for a single platform.

---

## Submit to stores

After a successful production build:

```bash
eas submit --platform ios --latest
eas submit --platform android --latest
```

EAS prompts for App Store Connect and Google Play credentials on first run
and stores them in EAS secrets for subsequent submissions.

---

## Validation guards

`app.config.ts` throws a descriptive error at config-evaluation time when:

- The `EAS_PROJECT_ID` constant is still the placeholder string (any EAS build)
- `EXPO_PUBLIC_DOMAIN` is not set (any EAS build)

This means a misconfigured build fails immediately — before compilation starts
— with a clear message explaining exactly which value is missing and how to
set it.

---

## Environment variable reference

| Variable | Where to set | Scope |
|----------|-------------|-------|
| `EAS_PROJECT_ID` | `app.config.ts` constant (commit it) | All profiles — same UUID |
| `EXPO_PUBLIC_DOMAIN` | EAS Environment Variables (`eas env:create`) | Per-environment (production / preview) |
| `EXPO_PUBLIC_REPL_ID` | Replit (auto-injected into dev script) | Local dev server only |

> Variables prefixed `EXPO_PUBLIC_` are embedded in the JS bundle and visible
> to client code. Never put API keys, tokens, or passwords in `EXPO_PUBLIC_`
> vars — route anything sensitive through the API server.
