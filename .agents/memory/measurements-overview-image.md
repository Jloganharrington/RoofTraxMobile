---
name: Roof overview diagram rendering
description: Gotchas around rendering the measurements PDF overview page and caching its URL on mobile
---

- ImageMagick in this environment is v7: the binary is `magick`, not `convert`. `convert` exists but is deprecated and PDF rendering via `execFileSync('convert', ...)` failed silently. Always use `magick`.
  **Why:** the overview image was never generated for weeks and the failure was swallowed by a non-fatal catch.
  **How to apply:** any server-side PDF/image rasterization must call `magick`.
- ImageMagick delegates PDF rendering to Ghostscript (`gs`) — it is NOT bundled and must be installed as a Nix system dependency (`ghostscript`), or `magick x.pdf x.jpg` fails with `gs: not found`.
- The roof diagram is fetched on demand via `render-overview-image` (renders one PDF page, returns 3h signed URL), never persisted in the DB. Mobile caches it in an in-memory store keyed by inspectionId (`overviewImageStore`); the cache and pending measurements must both be cleared when the measurements PDF is replaced.
- `getApiBaseUrl()` on mobile returns `https://<domain>/api` with NO trailing slash — hand-written fetches must include the `/` (`${apiBase}/inspections/...`). A missing slash produced `.../apiinspections/...`.
