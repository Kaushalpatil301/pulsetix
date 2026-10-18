# Code Standards

## General
- Small single-purpose modules. A file that needs a section comment to explain two jobs should be two files.
- Fix root causes; no layered workarounds. If a workaround is unavoidable, add `// WORKAROUND:` + why + removal condition.
- Do not mix HTTP concerns, business rules and SQL in one file (see Layering).
- Prefer boring and explicit over clever. This code is read on camera.

## JavaScript (Node 20, CommonJS)
- `'use strict'` via modules; `const` by default; no `var`.
- All async route handlers go through `asyncHandler`; never leave an unhandled rejection.
- Validate unknown external input (body, query, params, headers, env) with zod at the boundary; code past the boundary trusts types.
- Use typed domain errors: `class AppError extends Error { status, code, details }`. Only `errorHandler` turns errors into responses.
- JSDoc `@typedef` for shared shapes (booking, event, user) in `src/modules/*/types.js`.

## Layering (enforced in review)
- `routes.js`: parse/validate → call service → shape response. No SQL, no business rules.
- `service.js`: rules, orchestration, throws AppError. No `req`/`res`.
- `repo.js`: the ONLY place SQL lives. Parameterized queries only (`$1, $2`). String-built SQL is forbidden.
- `src/mail/` is imported only by queue handlers. A route importing mail is a bug.

## SQL and data
- Money = integer cents. Time = `timestamptz`, UTC.
- Inventory changes only via the patterns in architecture.md. Any new write to `available_tickets` needs an architecture update first.
- Migrations: `src/db/migrations/NNN_name.sql`, forward-only, idempotent where practical, never edited after being applied.
- Add an index only with a reason in the commit message (query it serves). Prove it with `EXPLAIN` if it is a performance claim.
- Keep transactions short: no network calls (SMTP, Redis) inside a DB transaction.

## API routes
- Order of middleware: requestId → rateLimit → authenticate → requireRole → validate → handler.
- Ownership enforced in SQL (`WHERE ... AND organizer_id = $n`).
- Responses follow `api-contract.md` exactly; error shape never varies.
- Never return `password_hash` or internal error text.

## Background jobs
- Handlers are idempotent and safe to retry. Use deterministic `jobId`s.
- A handler that sends email writes `notification_log` (dedupe) and respects `EMAIL_RATE_PER_SEC`.
- Throw to trigger a retry; return normally only when the work is fully done or intentionally skipped.

## Logging and observability
- pino JSON logs with `request_id`. No `console.log` in `src/` (lint rule).
- Log at boundaries: request summary, job start/finish/fail, outbox batch size. Never log passwords, tokens or full emails bodies.

## Testing
- Integration and concurrency tests run against REAL Postgres and Redis (docker-compose). Do not mock the database.
- Email transport is stubbed in tests with Nodemailer `jsonTransport` so assertions can read the message.
- Required tests: (a) RBAC matrix (every protected route × role → expected 401/403/2xx); (b) 500 parallel bookings on 100 tickets ⇒ exactly 100 bookings, `available=0`; (c) idempotent retry returns same booking, one outbox row; (d) PATCH by non-owner rejected; (e) capacity below sold rejected; (f) outbox row created in same transaction as booking; (g) worker retry does not double-send.
- Every bug found by a load test gets a regression test.
- Test names state behavior: `it('rejects a customer creating an event with 403')`.

## Config and secrets
- `src/config` parses env with zod and crashes at boot on missing/invalid values.
- `.env.example` lists every variable with a safe placeholder. `.env` is git-ignored.

## Git
- One commit per completed unit (conventional style: `feat(bookings): atomic reservation`). Commit messages for performance changes include the measured before/after and the result file name.

## File Organization
- `src/modules/<name>/` — routes, service, repo, schemas
- `src/queue/`, `src/outbox/`, `src/mail/` — async pipeline
- `src/naive/` — V1 baseline only
- `tests/{unit,integration,concurrency}/` — tests
- `loadtest/` — k6 scripts; `loadtest/results/` — raw result JSON (immutable once saved)
- `docs/` — benchmarks.md, decision notes, diagrams
