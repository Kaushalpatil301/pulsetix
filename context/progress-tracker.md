# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase
- Planning complete; implementation not started.

## Current Goal
- U0: bootstrap repo from the existing scaffold and align it to the context files.

## Completed
- Context files written (this folder).
- A first scaffold exists from an earlier session (Express + pg + BullMQ, atomic booking CTE, naive endpoint, k6 script). It predates these specs: it uses unprefixed routes, PUT, `tickets` instead of `tickets_count`, no idempotency, no outbox. Treat it as raw material, not as done work.

## Build Units (do in order; each has a timebox and a "done when")
| ID | Unit | Timebox | Done when |
|---|---|---|---|
| U0 | Repo bootstrap: docker-compose (Postgres+Redis), config validation, `app.js/server.js` split, `/api/health`, lint, test runner | 45m | `npm test` runs one health test green; `docker compose up` works |
| U1 | Migrations 001: users, events, bookings, outbox_events, notification_log + runner | 30m | migration applies cleanly on empty DB; constraints verified by a test |
| U2 | Auth + RBAC (register w/ organizer code, login, requireRole) | 60m | RBAC matrix test green; customer → organizer route = 403 |
| U3 | Events: create, list, get, PATCH (owner-only SQL guard), organizer bookings list | 75m | tests for ownership, capacity-below-sold, pagination |
| U4 | V1 naive booking in `src/naive/` + inline SMTP (isolated, env-gated) | 30m | endpoint books tickets; demonstrably races when hit in parallel |
| U5 | Email infra: SMTP provider account, mail module, worker process skeleton | 45m | `npm run mail:test` delivers a real email |
| U6 | Deploy skeleton to Render (API, worker, Postgres, Redis); smoke test live | 60m | live `/api/health` OK, register/login works on deployed URL |
| U7 | Baseline benchmark of V1 (k6 flash-sale, find breaking point, save raw results, record screen clips) | 60m | breaking point row in change log with result files |
| U8 | V2 booking: atomic statement + idempotency + outbox row; concurrency + idempotency tests | 75m | 500-on-100 test = exactly 100; idempotent retry test green |
| U9 | Outbox dispatcher + booking-confirmation job + notification_log dedupe | 60m | real confirmation email arrives; kill-worker test recovers |
| U10 | Event-update notification (PATCH → outbox → fan-out batches) | 60m | PATCH emails every booked customer, no duplicates on retry |
| U11 | Benchmark V2 + optimization ladder (one change per run) | 120m | change log filled; final table filled from real files |
| U12 | Hardening: rate limits, `/metrics`, request ids, `jobs:retry-failed` | 45m | metrics shows pool/queue; failed-job re-drive demonstrated |
| U13 | README (decisions, rejected alternatives, trade-offs), docs, rehearse + record video | 90m | README complete; video 3–4 min, face visible |

Deploy early (U6) and benchmark the baseline early (U7) so the video evidence exists even if time runs short.

## In Progress
- None yet.

## Next Up
- U0.

## Open Questions
- Deadline and total hours available? (drives the cut line)
- SMTP provider final choice (Brevo vs Gmail) and a Mailtrap inbox for load tests.
- Render region and plan tiers (affects benchmark numbers; record in performance-plan.md).
- Free-tier Render Postgres expiry date vs submission/evaluation date.

## Architecture Decisions
- Raw SQL with `pg`, no ORM: the booking must be one atomic statement and the SQL must be visible in the video; ORMs hide it.
- JavaScript, not TypeScript: speed of delivery; scaffold already exists; time is better spent on experiments.
- Single-statement booking (CTE) instead of explicit BEGIN/COMMIT: fewer round trips and a shorter row-lock window; unique-violation on the idempotency key rolls back the whole statement, including the decrement.
- Transactional outbox instead of enqueue-after-commit: closes the crash window between commit and enqueue.
- Fan-out per recipient with deterministic jobIds: isolated retries and no duplicate sends.
- Non-owner PATCH returns 404, not 403: does not reveal event existence.
- Organizer registration gated by an env signup code: satisfies "no free privileged roles" while letting graders create organizers.
- V3 (Redis Lua admission control) is documented, not built: needs reservation reconciliation and crash recovery that cannot be proven in the time available.

## Session Notes
- Existing code lives in `event-booking/` from the earlier session; reuse `src/schema.sql` ideas, the booking CTE, and `loadtest/booking.js`.
- Keep `ENABLE_NAIVE=false` in the final deployment; enable it only for the baseline run, then redeploy.
- Benchmark runs: rate limiting OFF, SMTP pointed at the sandbox inbox.
