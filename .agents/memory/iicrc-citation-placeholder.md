---
name: IICRC citation placeholder runtime
description: How the IICRC S500/S520 filter works end-to-end — DB flags, prompt injection, placeholder tokens, server-side approve gate, and UI fill-in.
---

# IICRC Citation Placeholder Runtime

## Rule
Standards entries with `humanEnteredProvisionsOnly = true` are excluded from AI prompt text. The generator appends a directive block instructing the AI to emit `{{IICRC_CITATION_PLACEHOLDER:entryKey}}` tokens instead of any licensed provision text.

**Why:** IICRC S500/S520 provision text is licensed; AI reproduction is a copyright/licensing violation. The gate must exist at both the prompt level (no IICRC text fed to the model) and the approval level (section cannot be approved while unfilled placeholders remain).

**How to apply:** Any new section generation path must check for `humanEnteredProvisionsOnly` entries and inject the IICRC directive block before calling the AI. Any new approve-alike flow must check `lintFindings` for `iicrc_citation_unfilled` findings and block with 422 if any are present.

## Key implementation details
- `entry_key` in `standards_entries` holds only the short key (e.g. `STD-WTR-01`); a separate `title` column holds the display label. These were split by migration from the original conflated format `key — title`.
- The PUT route for standards entries carries forward `title` and `humanEnteredProvisionsOnly` from the latest existing version when not supplied — partial updates must never silently wipe migration-stamped values.
- `extractUnfilledIicrcPlaceholders(html)` is exported from `sectionGeneration.ts` — use it anywhere placeholder detection is needed.
- Lint finding `ruleId: 'iicrc_citation_unfilled'` is added to `lintFindings` on `claim_sections` at generation time for each unfilled placeholder.
- The approve route checks `lintFindings` server-side and returns 422 with `unfilledCount` when IICRC findings are present.
- `SectionCard.tsx` detects tokens via regex, shows fill-in forms (citationText + locator), and blocks the Approve button locally — **the filled text is not yet persisted to the DB or substituted into compiled reports** (tracked separately).
