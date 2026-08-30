# Repository instructions

Before product, UX, UI, workflow, or architecture changes, read these files in order:

1. `docs/product-charter.md` — long-term product intent and non-negotiable business/UI principles.
2. `docs/phase0-business-ui-optimization-checklist.md` — the currently approved Phase 0 optimization PRD.
3. The relevant implementation and tests.

Important rules:

- This product exists to identify evidence-backed unmet needs and return 0–N real opportunities. It is not a generic analytics dashboard.
- Treat “看用户” as the demand taxonomy that connects market, competitor, self, and opportunity analysis.
- Distinguish current implementation from target-state requirements; do not assume the PRD is already implemented.
- Preserve the existing indigo/purple, white-card, rounded, friendly visual style. Improve hierarchy and usability instead of re-skinning it.
- Do not add Phase 0 validation-task management, deadlines, reminders, or complex portfolio management unless the user explicitly expands scope.
- AI conclusions must be traceable to evidence, allow human review, and may legitimately return zero opportunities.
- When a change affects product definitions, UI rules, scope, or workflow, update `docs/product-charter.md` and the Phase 0 PRD in the same change.
- For implementation work, verify with `npm test`, `npm run lint`, and `npm run build` unless the requested change is documentation-only.
