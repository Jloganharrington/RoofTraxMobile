---
name: expo-image-picker camera permission must be requested explicitly
description: launchCameraAsync throws (not auto-prompts) without a prior permission grant in SDK 17
---

# expo-image-picker: request camera permission before launching

`ImagePicker.launchCameraAsync()` (expo-image-picker SDK 17 / Expo SDK 54) does
**not** prompt for camera permission on its own — it throws when the permission
is undetermined or denied. Always call
`await ImagePicker.requestCameraPermissionsAsync()` and check `.granted` first.

**Why:** a preliminary-inspection capture screen failed with a generic "Could
not take the photo" because it launched the camera with no prior permission
request. A bare `catch {}` swallowed the underlying error, hiding the cause.

**How to apply:**
- Gate every `launchCameraAsync` behind an explicit permission request; throw a
  typed error (e.g. a `CameraPermissionDeniedError`) so the UI can show an
  actionable "enable camera in Settings" message instead of a generic failure.
- Never swallow capture errors with `catch {}` — at least `console.warn(err)` so
  the real reason is diagnosable.
- Declare native usage strings via the `expo-image-picker` / `expo-location`
  config plugins in `app.json`. These only take effect on a native rebuild
  (dev/EAS build), NOT in Expo Go — Expo Go relies on the runtime permission
  request, which is the actual fix there.

## Library upload vs camera capture: GPS provenance

When the same evidence-photo flow supports BOTH taking a new photo and
uploading an existing one, do NOT backfill a missing EXIF GPS location with the
device's *current* position for library uploads.

**Why:** an uploaded photo may have been shot at another place/time. A live
current-location fallback is only accurate for a freshly-taken photo; using it
for an upload fabricates the location on a forensic evidence record.

**How to apply:** camera capture may use a live-GPS fallback; library uploads
take GPS/time from the file's own EXIF or leave them null. Library uploads still
run through the identical persist → hash → outbox pipeline as captured photos.
`launchImageLibraryAsync` needs `requestMediaLibraryPermissionsAsync` first,
same throw-if-denied pattern as the camera.
