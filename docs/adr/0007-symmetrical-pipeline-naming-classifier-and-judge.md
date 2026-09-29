# ADR-0007: Symmetrical Pipeline Naming: Layer 1 Classifier and Layer 2 Judge

## Status
Accepted & Implemented - 2026-09-29

## Context
During the evolution of the zero-hardcoding hierarchical router, the component filenames in `src/router/` grew asymmetric and conceptually dissonant:
1. **Spatial vs. Architectural Mixing**: `local-classifier.ts` used a spatial execution descriptor (`local`), while `layer2-decision.ts` used an architectural layer index (`layer2`).
2. **Inconsistent Terminology**: One file was named a `classifier` while the other was named a `decision`.
3. **Cognitive Overhead**: New contributors and API consumers found it non-intuitive to understand that `local-classifier` was the Layer 1 stage preceding `layer2-decision`.

## Decision
Refactor and standardize all routing components into **strictly symmetrical, layer-aligned pipeline stages**:

1. **Standardize Module Naming**:
   - `src/router/layer1-classifier.ts` (Class: `Layer1Classifier`): Fast, sub-millisecond CPU micro-tensor feature classifier and confidence gatekeeper.
   - `src/router/layer2-judge.ts` (Class: `Layer2Judge`): Specialized semantic judge model equipped with multi-turn context history for authoritative tier adjudication.
2. **Standardize Model Scaffold Path**:
   - `models/layer1-classifier.json` becomes the canonical path for the auto-initialized micro-tensor base model scaffold.
3. **Standardize Distillation Script**:
   - `scripts/train-layer1-classifier.ts` (`bun run train:layer1`) replaces the legacy training script name.
4. **Physical Elimination of Legacy Files (Zero Cruft Principle)**:
   - In accordance with ADR-0001 (Zero Hardcoding & Zero Cruft), legacy files `src/router/local-classifier.ts`, `src/router/layer2-decision.ts`, `models/local-classifier.json`, and `scripts/train-local-classifier.ts` are completely removed.
   - All internal imports and entry points are cleanly updated to point directly to `layer1-classifier` and `layer2-judge`, preventing technical debt and misleading ghost files.
   - Model loaders retain backward-compatible fallback detection for any pre-existing custom `models/local-classifier.json`.

```
Routing Flow:
[Layer 0: Protocol Constraints] 
       │
       ▼
[Layer 1: layer1-classifier.ts] ──(High Confidence >= 0.85)──► Direct Execution
       │
       ▼ (Confidence < 0.85 or Base Model)
[Layer 2: layer2-judge.ts] ─────────────────────────────────► Authoritative Tier
```

## Consequences
- **Positive**:
  - Symmetrical, self-documenting directory structure: "Classifier leads at Layer 1; Judge adjudicates at Layer 2".
  - Perfect consistency across code, tests, configuration, and documentation.
  - Clean codebase with zero dead code or misleading re-export forwarding stubs.
