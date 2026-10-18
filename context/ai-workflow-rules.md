# AI Workflow Rules

## Approach
Build incrementally with a spec-driven workflow. The context files define what to build, how, and the current state.
Implement against the specs; do not infer or invent behavior. Time is limited and the graded outcome is a deployed system
plus a measured performance story, so favor a working vertical slice over broad unfinished surface area.

## Scoping Rules
- One unit from `progress-tracker.md` at a time; each unit ends in something verifiable by a command or request.
- Prefer small diffs. If a change touches more than ~6 files, say so and ask whether to split.
- Do not combine unrelated system boundaries in one step.
- Plan before code: for every unit, post (1) files to touch, (2) verification command(s), (3) risks. Wait for approval on units U4+.

## When to Split Work
Split a step if it combines:
- API route changes AND queue/worker changes
- Schema migrations AND behavior changes that depend on them (migrate first, verify, then build on it)
- Implementation AND benchmark tuning (never tune while building; measure first, change ONE thing, measure again)
- Anything not defined in the context files
If it cannot be verified end to end within a few minutes, the scope is too broad.

## Handling Missing Requirements
- Do not invent product behavior. If something is ambiguous, ask me; once answered, record it in the relevant context file.
- If a requirement is missing, add it to Open Questions in `progress-tracker.md` and continue with unrelated work.
- If the assignment text and a context file conflict, the assignment text wins and the context file gets corrected.

## Honesty Rules (hard)
- Never fabricate benchmark numbers, test results, or deployment status. If you did not run it, say "not run".
- Never write a number into `performance-plan.md` or the README without a file in `loadtest/results/` that backs it.
- Do not claim an invariant holds without pointing at the test or query that proves it.
- If you are unsure about a library API or a hosting-platform limit, say so and check the docs instead of guessing.
- Report failures plainly: what failed, the exact error, what you tried.

## Protected Files — do not modify unless I explicitly say so
- Applied migration files in `src/db/migrations/` (add a new migration instead)
- `loadtest/results/*` (raw evidence; append only)
- `context/architecture.md` invariants section (propose changes; do not edit silently)
- `package-lock.json` except via `npm install` for an agreed dependency
- `src/naive/` after the V1 baseline run is recorded (so the baseline stays reproducible)

## Keeping Docs in Sync
Update the relevant context file in the SAME change whenever you alter: endpoints/payloads/status codes (`api-contract.md`),
boundaries, data model, flows or invariants (`architecture.md`), conventions (`code-standards.md`), scope (`project-overview.md`).
README must reflect the final decisions; keep a running list of decisions + rejected alternatives in `progress-tracker.md` as you go so the README is assembly, not archaeology.

## Dependency Rules
- No new dependency without stating what it replaces/solves and its size/maintenance. Prefer stdlib.
- No ORM, no framework swap, no TypeScript migration, no microservices.

## Definition of Done (per unit)
1. Works end to end within the unit's scope (show the command/request and its real output).
2. `npm test` passes (state the counts) and `npm run lint` is clean.
3. No invariant in `architecture.md` violated (name the one most at risk and how it was checked).
4. Relevant context files and `progress-tracker.md` updated.
5. For performance units: raw result file saved and the change-log row filled.
6. Committed with a conventional message.

## Time Management
- Each unit has a timebox in `progress-tracker.md`. At 150% of the timebox, stop and re-scope instead of grinding.
- Cut line if time runs short, in this order: hardening (U12) → mixed-traffic load scenario → extra docs. Never cut: V1 baseline, V2 correctness, both real emails, deployment, benchmark evidence, video.
