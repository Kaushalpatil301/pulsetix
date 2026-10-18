# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase
- All core code units (U0-U5, U8-U10, U12, U13) implemented and verified.
- 46/46 automated tests passing (including 500-on-100 concurrency test).
- Real email delivery verified with Brevo API.

## Current Goal
- U6: Deploy to Render (or cloud provider of choice), run live smoke test and benchmarks.

## Completed
- **U0**: Repo bootstrap: docker-compose (Postgres+Redis), config validation (zod), app.js/server.js split, `/api/health`, test runner.
- **U1**: Migrations: users, events, bookings, outbox_events, notification_log + migration runner.
- **U2**: Auth + RBAC: JWT authentication, bcrypt passwords, ORGANIZER / CUSTOMER roles, signup code gate.
- **U3**: Events CRUD: create, list (paginated), get, PATCH with SQL ownership guard, organizer bookings list.
- **U4**: V1 naive booking in `src/naive/` + inline SMTP (env-gated via `ENABLE_NAIVE`).
- **U5**: Real email delivery via Brevo with fallback adapter (`src/mail/transport.js`), verified via `scripts/mail-test.js`.
- **U8**: V2 atomic booking CTE (`WITH booked AS (...) INSERT INTO bookings ...`) + Idempotency-Key handling + outbox transactional row.
- **U9**: Transactional outbox polling dispatcher + BullMQ email queue + booking confirmation handler with idempotency logging.
- **U10**: Event-update notification handler with fan-out to all confirmed customers.
- **U12**: Rate limiting (`express-rate-limit`), `/metrics` endpoint with token protection, `scripts/retry-failed-jobs.js`.
- **U13**: Comprehensive documentation in `README.md` (architecture, trade-offs, benchmarks, setup).

## Next Up
- **U6**: Push code to GitHub and connect to Render Blueprint (`render.yaml`) for live deployment.
- **U7 & U11**: Run k6 benchmark flash-sale scenarios against local or deployed endpoint to generate `loadtest/results/`.
- Rehearse and record 3-4 minute demo video.

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
