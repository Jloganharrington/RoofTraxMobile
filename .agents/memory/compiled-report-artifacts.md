---
name: Compiled report artifacts
description: Rules for persisting AI-generated report artifacts with photos and LLM HTML
---

# Compiled report artifacts

**Rule 1:** Never persist expiring signed URLs inside stored artifacts. Store a JSON data blob with stable `/objects/...` paths; sign URLs fresh at every preview/render request and return the rendered HTML directly (`{ html }`), not a signed URL to a stored file.
**Why:** A stored HTML report with 15-min signed photo URLs breaks silently after TTL — completion review rejected this outright.

**Rule 2:** LLM-generated HTML fragments are untrusted (user-supplied inspection fields flow into the prompt → prompt-injection XSS). Sanitize server-side with `sanitize-html` strict allowlist before storage, keep a server-built fallback if sanitization empties the fragment, and render in WebView with `javaScriptEnabled={false}` + navigation blocking.

**How to apply:** Any future export path (PDF, email) must resolve photo refs at generation time from the JSON blob, and reuse the sanitized fragments — never re-trust stored LLM output.

**Also:** esbuild config externalizes `@google/*`, so `@google/genai` must be a direct dependency of api-server (not just of the integrations lib) or the server crashes at startup with ERR_MODULE_NOT_FOUND.
