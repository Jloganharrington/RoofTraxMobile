---
name: Compiled report artifacts
description: Rules for persisting AI-generated report artifacts with photos and LLM HTML
---

# Compiled report artifacts

**Rule 1:** Never persist expiring signed URLs inside stored artifacts. Store a JSON data blob with stable `/objects/...` paths; sign URLs fresh at every preview/render request and return the rendered HTML directly (`{ html }`), not a signed URL to a stored file.
**Why:** A stored HTML report with 15-min signed photo URLs breaks silently after TTL — completion review rejected this outright.

**Rule 2:** LLM-generated HTML fragments are untrusted (user-supplied inspection fields flow into the prompt → prompt-injection XSS). Sanitize server-side with `sanitize-html` strict allowlist before storage, keep a server-built fallback if sanitization empties the fragment, and render in WebView with `javaScriptEnabled={false}` + navigation blocking.

**How to apply:** Any future export path (PDF, email) must resolve photo refs at generation time from the JSON blob, and reuse the sanitized fragments — never re-trust stored LLM output.

**Rule 3:** Provenance (evidence manifest: photo ids, capture timestamps, sha256, annotation overlays) must be built server-side from DB rows at compile time and baked into each compiled blob — never AI-generated and never replaced by AI captions. Keep an append-only jsonb version history (`||` append, never read-modify-write) since the report path pointer is overwritten per compile; digest the manifest (sorted entries → sha256) so tampering is detectable. Renderers must gate new sections on schemaVersion/field presence so older blobs still render.

**Rule 4:** Evidence→scope links (photo/finding → estimate line) carry provenance (`linkSource`) and review state; only `approved` links may enter the compiled snapshot, the manifest hash, or carrier-facing rendering — AI-suggested links are never verified until approved. Review stamps (`reviewedBy/reviewedAt`) are server-assigned; the request schema must not accept them, and idempotent replays must preserve prior stamps. Validate link targets against inspection+company scope (dangling/cross-tenant ids → 400). Appendix tables omit missing mappings rather than inferring them.

**Rule 5:** Content controls on AI report fragments live in one shared policy module (prompt text + lint rules) consumed by every generation model, so prompts can't drift. Lint runs server-side after generation and stores status/findings verbatim with the blob — AI text is never rewritten. A `blocked` status gates export at render time; the reviewer bypass (`?review=1`) and explicit resolution are authorization boundaries (manager/admin only), and resolution is scoped to the exact blob path so any re-compile re-enters the gate. Lint regexes must be phrase-level/context-aware ("covered by the policy", not bare "covered") to survive roofing vocabulary.

**Also:** esbuild config externalizes `@google/*`, so `@google/genai` must be a direct dependency of api-server (not just of the integrations lib) or the server crashes at startup with ERR_MODULE_NOT_FOUND.
