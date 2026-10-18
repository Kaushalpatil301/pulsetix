# AGENTS.md — PulseTix (entry point for any AI coding tool)

Copy/rename this file to `CLAUDE.md` (Claude Code), `.cursorrules` (Cursor) or `.github/copilot-instructions.md` (Copilot).
It is the only file the tool is guaranteed to load, so it points to everything else.

## What this repo is
PulseTix: a backend-only, high-concurrency event booking REST API. It is an assignment submission that is graded on
correctness under load, real background emails, deployment, and a measured before/after performance story.

## Read these before writing any code (in this order)
1. `context/project-overview.md`  — what and why, scope, success criteria
2. `context/architecture.md`      — stack, boundaries, data model, flows, INVARIANTS
3. `context/api-contract.md`      — every endpoint, payload, status code, error shape
4. `context/code-standards.md`    — how code is written and tested here
5. `context/ai-workflow-rules.md` — how you must work (scoping, definition of done, honesty rules)
6. `context/performance-plan.md`  — benchmark protocol and results log
7. `context/progress-tracker.md`  — CURRENT STATE. Read last. Update after every unit.

## Precedence when files disagree
`architecture.md` invariants  >  `api-contract.md`  >  `code-standards.md`  >  everything else.
If two files conflict, stop and ask; do not pick silently.

## Non-negotiables (details in the files above)
- Never oversell. Inventory is protected by one conditional UPDATE + a CHECK constraint.
- HTTP handlers never send email. Email only happens in the worker, fed by the transactional outbox.
- Never invent a benchmark number. Numbers come only from saved raw k6 output in `loadtest/results/`.
- Never say tests pass unless you ran them in this session and saw the output.
- One unit of work at a time (see `progress-tracker.md`). Do not start the next unit unprompted.

## Session start prompt (paste this)
> Read AGENTS.md and the context files in order. Summarize the current state from progress-tracker.md in 5 lines.
> Then propose a plan for unit <ID> only: files to touch, how I will verify it, and what could go wrong. Wait for my OK.

## Session end prompt (paste this)
> Run the verification for this unit. Update progress-tracker.md (Completed, Next Up, Open Questions, Session Notes).
> If you changed any architecture/API/standards behavior, update that context file in the same change.
