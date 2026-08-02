---
name: Facet routing two-stage AI flow
description: EXTRACT→SEQUENCE facet routing invariants for measurements analysis and the confirm-screen route UI.
---

- EXTRACT runs inside the analyze-measurements route (one document-bearing AI call per report); re-analysis must clear entryFacetId + facetSequence or the old route survives a new graph.
- SEQUENCE is text-only (graph JSON, no PDF); changing entry facet must never re-run extraction.
- **Why:** spec acceptance criteria — cost and consistency; the graph is the single source of truth.
- Sequence validation lives server-side: F1=entry, full coverage, contiguous F-numbers, transition chain matches previous step, non-dismount transitions must match a graph edge of the same type, ladderMoves == dismount count. One retry with validation errors appended, then fail.
- Verbatim system prompt is a disk file under artifacts/api-server/prompts/, loaded lazily with cwd-relative + repo-root fallback paths and a fail-fast error — esbuild bundles to dist, so never rely on module-relative paths.
- Mobile fallback: when facetGraphStatus != complete, the confirm screen keeps the manual tap-in-walking-order flow so field reps are never blocked.
- Apply payload F-labels come from the sequence order; wizard transition notes are matched by slope label (F1…Fn), so slope labels and sequence order must stay in lockstep.
