# Track A — Compile & Attest Integrity (P0)
SCOPE: proofPackageTemplate, compile route/service, attest route/service, generationSnapshot, compiledReportVersions, deliver gate. DO NOT touch: curation manifest, generation workers, standards/detriment library data, pipeline stages, supplement routes.

Fixes audit findings F-6 (A–M badge scheme in template) and F-8 (attestation binds to pre-existing blob; no signed recompile). These were specified in the earlier six-fix remediation prompt — first check whether that prompt partially ran; verify-then-fix each item.

## 1. Badge authority unification (F-6)
The exhibitBadgeMap (class-prefixed S/R/I/F/C/T-#, frozen per-class counters, assigned at exhibit finalization) is the ONLY badge authority. proofPackageTemplate currently carries an A–M letter scheme — remove it entirely:
- The template CONSUMES badges from exhibitBadgeMap; it never assigns, re-letters, or re-orders them.
- Compile assigns badges only to non-photo content slots not already in the map, appending within class; it must never touch existing assignments or reset counters (guard + test).
- Captions render "Photo — Exhibit {badge} — ..." using map badges.
- Acceptance: grep the entire codebase for the A–M scheme (letter-badge generation, 'A'..'M' exhibit arrays, charCode badge math) — zero remnants. Test: finalize exhibits → compile → recompile → assignments byte-identical; add one photo → next class counter, nothing renumbered.

## 2. Post-attest signed recompile (F-8)
Current: attestation row binds to the existing blob; the delivered PDF contains no rendered attestation and the snapshot cannot prove the signature. Required flow:
- "Attest & Sign Report": (a) validate all sections locked + a compiled review blob exists; (b) write reportAttestations row referencing that blob version; (c) AUTOMATICALLY trigger a final recompile producing a NEW blob version whose rendered attestation block and generationSnapshot include reportAttestationId + preparedAt.
- Never mutate an existing blob. compiledReportVersions is append-only; the pre-attestation blob remains as the review version.
- Attestation block rendering in the signed blob: attestation_block_b in ALL cases, internal branch on preparer_is_inspector (block_a must be impossible at report level — verify the selection code, cite it in the PR description).
- generationSnapshot in the signed blob additionally carries: reportAttestationId, preparedAt, and (verify present, add if missing) standardsCited [{entryKey, verificationStatus, verifiedAt}] as of compile time.
- Deliver gate: POST deliver returns 422 unless a blob version exists whose snapshot contains reportAttestationId. Gate on the signed blob, not the attestation row alone.
- Test: compile → attest → assert new blob version exists, review blob unchanged, signed blob layout identical to review blob EXCEPT the attestation block (badge assignments and section versions byte-identical between the two), deliver succeeds only after.

## 3. Migration
Any existing attestation rows bound to pre-attestation blobs: leave the blobs untouched, flag the attestation rows legacy_pre_recompile=true. Going forward only the new flow runs.

Run the full test suite. PR description must list: evidence the A–M scheme is gone, the block-selection code path, and the compile→attest→deliver test output.
