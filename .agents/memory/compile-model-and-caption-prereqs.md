---
name: Compile route model + caption prerequisites
description: Report compile uses gemini-2.5-flash; captions must be generated and set-captions non-empty before compile runs the proofPackageTemplate gate.
---

# Report compile: model and caption prerequisites

## Rule
1. The compile route uses `gemini-2.5-flash` (changed from `gemini-3.1-pro-preview` which was unavailable).
2. Compile has a **hard gate** inside `compileInspectionReport()`: every confirmed comparison pair must have a non-empty `captionText` in `comparison_set_captions`. This gate runs *after* the Gemini call, so a 422 is returned if captions were never generated.
3. The accepted curation order is: finalize badges → generate captions → approve captions → compile.
4. `comparison_set_captions` rows are created by finalize (one per pair) with `state: 'pending'` and `captionText: null`. Caption generation fills the text; approval advances state. Compile checks text non-null only (state is irrelevant to the compile gate).

## Why
The caption generation route (POST /:id/sections/captions/generate) is the only path that creates text for comparison set captions; there is no manual PATCH for them until after they exist. Skipping caption generation causes compile to 422 (missing set captions).

## How to apply
Acceptance fixtures and any automation that drives a claim through to compile must run caption generate + approve between finalize and compile.
