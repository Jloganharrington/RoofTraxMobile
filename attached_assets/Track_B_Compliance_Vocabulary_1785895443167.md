# Track B — Compliance & Vocabulary (P0)
SCOPE: standards_entries data + import defaults, generation-worker prompt assembly (exclusion logic only), eave-component label vocabulary (shared vocab + web rendering + field-app labels if in this repo). DO NOT touch: compile/attest code, curation manifest, badge logic, pipeline stages, supplement routes.

Fixes audit findings F-5 (humanEnteredProvisionsOnly false for IICRC entries) and F-7 (eave label vocabulary), plus verification that the IICRC prompt-exclusion worker logic from the earlier remediation batch exists at all.

## 1. IICRC flags + exclusion (F-5)
- Data: set humanEnteredProvisionsOnly=true on STD-WTR-01 (ANSI/IICRC S500-2021) and STD-WTR-02 (ANSI/IICRC S520-2024). Ensure the standards importer maps the HumanEnteredProvisionsOnly field from the import format so future imports set it correctly (verify against the import file format: 'Field: value' lines, entries delimited by '=== ENTRY ===').
- Worker logic (VERIFY FIRST — may be entirely missing): generation workers must EXCLUDE any standards entry with humanEnteredProvisionsOnly=true from AI prompt context. Where a section needs such a citation, the worker emits a citation placeholder token the reviewer completes from the licensed copy. No IICRC citation text, locator text, or provision text may appear in any assembled prompt payload.
- Citation-readiness lint: an entry with humanEnteredProvisionsOnly=true cannot be cited by a section until its locatorTemplate is human-populated — surface as a section lint finding, not a compile crash.
- Test: build a claim with interior_scope_present=true; assert (a) readiness passes with verified IICRC entries (no verify_before_ship deadlock), (b) the assembled prompt for the relevant sections contains zero IICRC strings (assert on 'S500', 'S520', 'IICRC' absent from prompt payloads), (c) the generated section contains the placeholder, (d) compile succeeds after the reviewer fills the citation.

## 2. Eave component vocabulary (F-7)
Current: Present / Absent / Not determined. Required: Present / Not Observed / Undetermined.
- Update the shared vocabulary/enum, the web rendering (Class 8 edge/assembly caption output mirrors the record exactly), and the field-app capture labels if the field app lives in this repo (if it does not, list the field-app change as a handoff note in the PR — do not skip silently).
- Migration: existing records with 'Absent' map to 'Not Observed'; existing 'Not determined' maps to 'Undetermined'. Preserve original values in a legacyValue field on migrated records (these are attested records — the display vocabulary changes, the attested capture is preserved).
- Optional fourth value 'Absent (fully exposed)' is NOT being added in this pass — do not invent it.
- Test: an edge-assembly caption renders "drip edge present, gutter apron not observed, ice-and-water barrier not observed (undetermined)" style output with the new vocabulary.

Run the full test suite. PR description must include the prompt-payload assertion output proving IICRC exclusion.
