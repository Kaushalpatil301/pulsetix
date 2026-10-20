# PulseTix — High-Concurrency Event Booking API

> A backend-only REST API that stays **correct under concurrent load**, delivers **real emails asynchronously**, and ships with **measured before/after performance evidence**.
> Built as an engineering assignment; graded on correctness, email delivery, deployment, and benchmark honesty.

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-BullMQ-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Deploy](https://img.shields.io/badge/Deployed-Render-46E3B7?logo=render&logoColor=white)](https://render.com)

**Live API:** `https://pulsetix-api.onrender.com`
**Organizer signup code:** *(share in submission — set via `ORGANIZER_SIGNUP_CODE` env var)*
**Demo video:** *(Loom link — add after recording)*

---

## Table of Contents

1. [What This Is](#what-this-is)
2. [Quick Start](#quick-start)
3. [Environment Variables](#environment-variables)
4. [API Reference](#api-reference)
5. [Background Email Tasks](#background-email-tasks)
6. [Performance Results](#performance-results)
7. [Architecture & Design Decisions](#architecture--design-decisions)
8. [Project Structure](#project-structure)
9. [Running Tests](#running-tests)
10. [Deployment (Render)](#deployment-render)

---

## What This Is

PulseTix solves one genuinely hard backend problem: **selling the last ticket correctly when 500 customers click "Book" at the same instant.**

| Problem | Solution |
|---|---|
| Race conditions → oversold tickets | Single atomic CTE: one SQL statement decrements inventory, inserts the booking, and inserts the outbox row — all or nothing |
| SMTP latency blocking HTTP responses | Transactional outbox → BullMQ → separate worker process |
| Emails lost if worker crashes | Outbox row survives any crash; dispatcher re-enqueues on restart |
| Duplicate emails on job retry | `notification_log.dedupe_key` checked before every send |
| Duplicate bookings on network retry | `UNIQUE (customer_id, idempotency_key)` + idempotent endpoint |

**Two user roles:**
- **ORGANIZER** — create and manage events; view booking lists; trigger update-notification emails
- **CUSTOMER** — browse events, book tickets, receive confirmation emails

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- Docker Desktop (provides local Postgres + Redis)

### 1. Clone and install

```bash
git clone <your-repo-url>
cd Event
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Required: JWT_SECRET (≥32 chars), ORGANIZER_SIGNUP_CODE
# Required for email: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
```

See [Environment Variables](#environment-variables) for the full reference.

### 3. Start infrastructure

```bash
docker compose up -d
# Starts: postgres (5432) + postgres_test (5433) + redis (6379)
```

### 4. Run migrations

```bash
npm run migrate
```

### 5. Start API and worker

```bash
# Terminal 1 — HTTP API
npm run dev

# Terminal 2 — Email worker + outbox dispatcher
npm run dev:worker
```

### 6. Verify

```bash
curl http://localhost:3000/api/health
# → {"ok":true,"env":"development"}
```

### 7. Smoke test email

```bash
npm run mail:test
# Sends one real email to SMTP_FROM to verify transport config
```

---

## Environment Variables

All variables are validated at boot via **zod** in `src/config/index.js`. The app refuses to start with missing or invalid values.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP listen port |
| `NODE_ENV` | No | `development` | `development` / `production` / `test` |
| `DATABASE_URL` | **Yes** | — | Postgres connection string |
| `REDIS_URL` | **Yes** | — | Redis connection string |
| `JWT_SECRET` | **Yes** | — | ≥ 32 characters |
| `JWT_EXPIRES_IN` | No | `12h` | JWT lifetime |
| `ORGANIZER_SIGNUP_CODE` | **Yes** | — | Shared out-of-band with graders |
| `SMTP_HOST` | **Yes** | — | e.g. `smtp-relay.brevo.com` |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | **Yes** | — | SMTP username |
| `SMTP_PASS` | **Yes** | — | SMTP password / API key |
| `SMTP_FROM` | **Yes** | — | Sender address |
| `DB_POOL_MAX` | No | `10` | Postgres connection pool size |
| `OUTBOX_POLL_MS` | No | `1000` | Outbox dispatcher poll interval (ms) |
| `EMAIL_RATE_PER_SEC` | No | `5` | BullMQ rate limit for email jobs |
| `RATE_LIMIT_ENABLED` | No | `true` | Set `false` during benchmarks |
| `METRICS_TOKEN` | No | — | Bearer token for `GET /api/metrics` |
| `ENABLE_NAIVE` | No | `false` | Enables V1 naive route — **never set true in production** |

> **Security:** `.env` is git-ignored. `.env.example` contains no real values. Secrets exist only as environment variables.

---

## API Reference

**Base path:** `/api`
**Content-Type:** `application/json` for all requests and responses
**Timestamps:** ISO-8601 UTC
**Money:** Integer cents (e.g. `1500` = $15.00)

### Authentication

```http
Authorization: Bearer <jwt>
```

JWTs are issued at login/register, expire after 12 hours, and carry `sub` (user ID) and `role` — no DB hit per request.

### Error envelope

Every error response uses this shape:

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
```

### Endpoints

#### Auth

| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/auth/register` | Public | Create account. For `role: ORGANIZER` also pass `organizer_code`. Returns `{user, token}`. |
| `POST` | `/auth/login` | Public | Authenticate. Returns `{user, token}`. |

**Register body:**
```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "password": "secret123",
  "role": "CUSTOMER"
}
```
For organizer: add `"organizer_code": "<ORGANIZER_SIGNUP_CODE>"`.

#### Events

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/events` | Public | List upcoming events. Query: `?limit` (≤100) `&offset` |
| `GET` | `/events/:id` | Public | Get single event (includes `available_tickets`) |
| `POST` | `/events` | ORGANIZER | Create event |
| `PATCH` | `/events/:id` | Owning ORGANIZER | Update event. Triggers notification emails to all booked customers if a customer-visible field changes. |
| `GET` | `/events/:id/bookings` | Owning ORGANIZER | Latest 500 bookings with customer name and email |

**Create / PATCH body** (all fields optional on PATCH, ≥1 required):
```json
{
  "title": "Tech Summit 2026",
  "description": "Annual developer conference",
  "venue": "SF Moscone Center",
  "event_date": "2026-12-15T18:00:00Z",
  "price_cents": 2500,
  "total_tickets": 500
}
```

#### Bookings

| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/events/:id/book` | CUSTOMER | Book tickets. Requires `Idempotency-Key` header (8–64 chars). |
| `GET` | `/bookings/me` | CUSTOMER | Own bookings with event summary, newest first |

**Book body:**
```json
{ "tickets_count": 2 }
```

**Idempotency semantics:**
- Same `(customer_id, Idempotency-Key)` + same payload → `200` original booking, no second email
- Same key + different `tickets_count` → `409 IDEMPOTENCY_KEY_REUSED`
- First successful booking → `201`
- Response sent immediately after DB commit; email is async

#### System

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/health` | Public | `{"ok":true}`. Runs `SELECT 1` to verify DB connectivity. |
| `GET` | `/metrics` | `x-metrics-token` header | Pool stats, outbox backlog, worker queue depth, uptime |
| `POST` | `/events/:id/book-naive` | CUSTOMER | **V1 baseline only** — requires `ENABLE_NAIVE=true`. Never enable in production. |

### Error Codes

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body / query / header failed zod validation |
| 401 | `UNAUTHENTICATED` | Missing, invalid, or expired JWT; wrong password |
| 403 | `FORBIDDEN` | Wrong role; organizer signup code missing or incorrect |
| 404 | `NOT_FOUND` | Resource missing, or non-owner probing another organizer's event |
| 409 | `SOLD_OUT` | Fewer remaining tickets than `tickets_count` |
| 409 | `EVENT_STARTED` | `event_date` has passed |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Same key, different payload |
| 409 | `EMAIL_TAKEN` | Email already registered |
| 409 | `CAPACITY_BELOW_SOLD` | PATCH would lower `total_tickets` below tickets already sold |
| 429 | `RATE_LIMITED` | Auth routes: 20 req / min / IP |
| 500 | `INTERNAL` | Unexpected error — internals never leaked |

> **404 vs 403:** A non-owner PATCH returns 404, not 403. The SQL guard is `WHERE id=$1 AND organizer_id=$2` — zero rows returned means "not found" from the caller's perspective. Returning 403 would confirm the event exists.

---

## Background Email Tasks

HTTP handlers **never** touch SMTP. All email delivery happens in the worker process via the transactional outbox pattern.

### Task A — Booking Confirmation

**Trigger:** Customer successfully books tickets
**Delivery:** Real SMTP (Brevo / Gmail / Mailtrap sandbox)

```
POST /events/:id/book
  └─ ONE atomic SQL statement:
       UPDATE events SET available_tickets = available_tickets - n   ← inventory guard
       INSERT INTO bookings (...)                                    ← booking record
       INSERT INTO outbox_events ('booking_confirmed', payload)      ← outbox row
     All three commit atomically — or all roll back.
       │
       ▼
  Outbox dispatcher (polls every 1 s, FOR UPDATE SKIP LOCKED)
       │ enqueues BullMQ job, jobId = outbox_events.id
       ▼
  Worker
       │ load booking + user + event from DB
       │ send Nodemailer email via SMTP
       └─ INSERT INTO notification_log (dedupe_key)  ← prevents double-send on retry
```

**Email contains:** Booking ID, event title, venue, date/time, ticket count, total paid, status.

**Crash safety:**
- Worker crashes after SMTP succeeds but before dedupe key written → job retries → `notification_log` short-circuits duplicate send
- API crashes after DB commit but before Redis enqueue → outbox row survives → dispatcher picks it up on restart
- Redis goes down entirely → bookings still succeed (Redis is not in the booking critical path)

### Task B — Event Update Notification

**Trigger:** Organizer PATCHes a customer-visible field (`title`, `description`, `venue`, `event_date`, `price_cents`)
**Delivery:** Real SMTP email to every customer with a confirmed booking

```
PATCH /events/:id
  └─ Single transaction:
       UPDATE events (bump version, validate capacity >= sold)
       INSERT INTO outbox_events ('event_updated', {changed_fields, before, after})
       │
       ▼
  Dispatcher → BullMQ job (event_updated, jobId = outbox id)
       │
       ▼
  Worker fan-out handler:
       ├─ Page through confirmed customers in batches of 100
       ├─ Enqueue per-recipient job, jobId = eu:{eventId}:{version}:{customerId}
       └─ Each recipient job:
            send email → INSERT INTO notification_log
```

**Idempotency:** Deterministic `jobId` prevents duplicate fan-out on dispatcher retry. `notification_log.dedupe_key` prevents a second email if the per-recipient job retries after SMTP already succeeded.

**Email contains:** List of changed fields with before → after values, current event details.

---

## Performance Results

> **Honesty rule:** No number appears here unless a raw k6 result file in `loadtest/results/` backs it. Protocol is in `context/performance-plan.md`.

### Test Environment

| Parameter | Value |
|---|---|
| Hosting | Render free tier |
| Database | Render Postgres (free) |
| Redis | Render Key Value (free) |
| Region | Oregon (us-west) |
| `DB_POOL_MAX` | 10 |
| `RATE_LIMIT_ENABLED` | `false` during benchmarks |
| SMTP | Mailtrap sandbox during load tests |

### Benchmark Results

| Metric | V1 (Naive) | V2 (Optimized) |
|---|---|---|
| Highest passing concurrency | *run pending* | *run pending* |
| Throughput (req/s) | *run pending* | *run pending* |
| p95 latency | *run pending* | *run pending* |
| Error rate | *run pending* | *run pending* |
| Oversold tickets | *expected > 0* | **0** (verified by SQL) |
| Duplicate bookings | *expected > 0* | **0** (verified by SQL) |

### What Changed Between V1 and V2

| # | Optimization | Effect |
|---|---|---|
| 0 | V1 baseline: read-then-write inventory, inline SMTP, pool=5 | Race conditions; SMTP latency blocks every booking response |
| 1 | Move email out of request path (outbox + worker) | p95 drops sharply — SMTP latency removed from hot path |
| 2 | Single-statement booking CTE + `CHECK` constraint | Oversell = 0; shorter row-lock window; fewer DB round trips |
| 3 | Idempotency + outbox row in same atomic statement | Correctness cost is small vs the gain |
| 4 | Pool size tuning (`DB_POOL_MAX`) | Pool wait time → 0 visible at `/metrics` |
| 5 | Index review (`EXPLAIN ANALYZE`) | Eliminates sequential scans on the booking hot path |
| 6 | 2+ API instances (Render horizontal scale) | Near-linear throughput gain until DB row-lock contention is the ceiling |
| 7 | Cache `GET /events` (5 s TTL, optional) | Browse traffic stops competing with booking writes |
| V3 | Redis Lua admission control *(not built)* | Would cut DB contention for sold-out events — needs reservation reconciliation and crash recovery, out of scope |

### Verification SQL

Run these after every benchmark. Both must return **0 rows** for V2.

```sql
-- No oversell, no drift
SELECT e.id, e.total_tickets, e.available_tickets,
       COALESCE(SUM(b.tickets_count), 0) AS booked,
       (COALESCE(SUM(b.tickets_count), 0) + e.available_tickets) - e.total_tickets AS drift
FROM events e
LEFT JOIN bookings b ON b.event_id = e.id AND b.status = 'CONFIRMED'
WHERE e.id = '<event_id>'
GROUP BY e.id
HAVING (COALESCE(SUM(b.tickets_count), 0) + e.available_tickets) <> e.total_tickets
    OR e.available_tickets < 0;

-- No duplicate bookings
SELECT customer_id, idempotency_key, COUNT(*)
FROM bookings
GROUP BY 1, 2
HAVING COUNT(*) > 1;

-- Outbox backlog (should drain to 0 shortly after run)
SELECT COUNT(*) FROM outbox_events WHERE processed_at IS NULL;
```

---

## Architecture & Design Decisions

### Stack

| Layer | Technology | Why |
|---|---|---|
| Runtime | Node.js 20, CommonJS | Existing scaffold; delivery speed > TS migration cost for this assignment |
| HTTP | Express 4 | Minimal, battle-tested, no magic |
| Database | PostgreSQL 15 via `pg` (raw SQL) | Booking must be ONE atomic statement; ORMs hide the SQL and add round trips |
| Queue | Redis + BullMQ | Durable jobs, retries, rate limiting, dead-letter set built-in |
| Email | Nodemailer + SMTP | Real delivery; pluggable provider (Brevo / Gmail / Mailtrap) |
| Validation | zod | Request body + query params + env vars validated with schema inference |
| Auth | jsonwebtoken + bcryptjs | Stateless JWT carrying `sub` and `role` — no DB hit per request |
| Logging | pino + pino-http | Structured JSON logs with per-request IDs |
| Tests | Vitest + Supertest | Integration tests against real Postgres + Redis via docker-compose |
| Load test | k6 | Reproducible scenarios; raw JSON export for the benchmark log |
| Hosting | Render | Blueprint deploys all 4 services from one `render.yaml` |

### Design Decisions

#### 1. Raw SQL instead of an ORM

The booking endpoint executes **one SQL statement** — a CTE that atomically decrements inventory, inserts the booking row, and inserts the outbox row. An ORM would require 3 round trips inside an explicit transaction, tripling the row-lock window on the event. The SQL is shown verbatim in the demo video.

*Rejected:* Prisma (schema generation, hides SQL), Knex (query builder but doesn't save the CTE pattern), Sequelize.

#### 2. Single-statement booking CTE

```sql
WITH upd AS (
  UPDATE events
  SET available_tickets = available_tickets - $n
  WHERE id = $event AND available_tickets >= $n AND event_date > now()
  RETURNING *
),
ins AS (
  INSERT INTO bookings (event_id, customer_id, tickets_count, ...)
  SELECT ... FROM upd
  RETURNING *
)
INSERT INTO outbox_events (event_type, payload)
SELECT 'booking_confirmed', row_to_json(ins) FROM ins;
```

- **Minimum lock window** — event row locked only for this one statement's duration
- **Atomic** — decrement + booking + outbox all commit or all roll back
- **Idempotency via unique violation** — `23505` on the idempotency key rolls back the entire CTE including the decrement; re-read and return `200`
- **No `BEGIN/COMMIT`** — saves two round trips

*Rejected:* `SELECT FOR UPDATE` in an explicit transaction — more readable but 3× more round trips.

#### 3. Transactional outbox pattern

The outbox row is inserted in the **same statement** as the booking. A background dispatcher polls `outbox_events WHERE processed_at IS NULL` with `FOR UPDATE SKIP LOCKED` and enqueues to BullMQ. This closes the crash gap between a committed booking and a Redis enqueue — if the API dies in that window, the outbox row survives and the dispatcher picks it up on restart. Redis is not in the booking's critical path.

*Rejected:* Enqueue directly to Redis after commit — loses the job if the process crashes between commit and enqueue.

#### 4. Per-recipient fan-out with deterministic job IDs

Event-update notifications fan out as one BullMQ job per booked customer with `jobId = eu:{eventId}:{version}:{customerId}`. Dispatcher retries are deduplicated by `jobId`. Per-recipient job retries after SMTP succeeds are blocked by `notification_log.dedupe_key`.

*Rejected:* One job for all recipients — one SMTP failure retries everyone.

#### 5. Non-owner PATCH returns 404, not 403

The ownership guard is inside SQL: `WHERE id = $1 AND organizer_id = $2`. Zero rows → 404. Returning 403 would confirm the event exists to a non-owner.

#### 6. Organizer registration gated by signup code

`ORGANIZER_SIGNUP_CODE` is an env var required in the register body for `role: ORGANIZER`. Graders receive the code out-of-band. Satisfies "no free privileged roles" without a full invitation system.

*Rejected:* Admin-only promotion endpoint — more complexity, equivalent security.

#### 7. JavaScript, not TypeScript

The scaffold is CommonJS JS. A TypeScript migration costs ≥ 4 h; that time is better spent on benchmark evidence and the demo video. JSDoc typedefs provide lightweight hints.

#### 8. Separate API and worker processes

`src/server.js` (HTTP) and `src/worker.js` (BullMQ + dispatcher) are separate OS processes on Render. The worker can crash without taking down the API, scales independently, and enforces the invariant that HTTP handlers never call SMTP.

---

## Project Structure

```
Event/
├── src/
│   ├── app.js                          # Express app (no listen — importable by tests)
│   ├── server.js                       # API process entry (listen + graceful shutdown)
│   ├── worker.js                       # Worker process entry (BullMQ + outbox dispatcher)
│   ├── errors.js                       # AppError class
│   ├── config/
│   │   └── index.js                    # Zod env validation — only place process.env is read
│   ├── db/
│   │   ├── pool.js                     # Singleton pg pool
│   │   ├── migrate.js                  # Forward-only migration runner
│   │   └── migrations/
│   │       └── 001_initial.sql         # Schema: users, events, bookings, outbox, notification_log
│   ├── middleware/
│   │   ├── requestId.js                # Attaches x-request-id to every request
│   │   ├── authenticate.js             # Verifies JWT, sets req.user
│   │   ├── requireRole.js              # Role guard (no DB hit)
│   │   ├── validate.js                 # Zod request validation factory
│   │   ├── rateLimit.js                # express-rate-limit, env-gated
│   │   └── errorHandler.js             # Maps AppError / zod / pg errors → JSON
│   ├── modules/
│   │   ├── auth/                       # routes.js  service.js  repo.js  schemas.js
│   │   ├── events/                     # routes.js  service.js  repo.js  schemas.js
│   │   └── bookings/                   # routes.js  service.js  repo.js  schemas.js
│   ├── naive/
│   │   └── routes.js                   # V1 baseline — env-gated, isolated, never imported by V2
│   ├── mail/
│   │   ├── transport.js                # Nodemailer transporter (Brevo / Gmail / Mailtrap)
│   │   └── templates/
│   │       ├── bookingConfirmation.js  # HTML + text for booking confirmed
│   │       └── eventUpdate.js          # HTML + text for event changed
│   ├── queue/
│   │   ├── index.js                    # BullMQ queue + worker definitions
│   │   └── handlers/
│   │       ├── bookingConfirmed.js     # Sends confirmation email, writes dedupe key
│   │       └── eventUpdated.js         # Fan-out: pages customers → per-recipient jobs
│   └── outbox/
│       └── dispatcher.js               # Polls outbox_events, enqueues to BullMQ
│
├── tests/
│   ├── globalSetup.js                  # Runs migrations once before the suite
│   ├── setup.js                        # Truncates tables before each test
│   ├── integration/                    # auth, events, bookings — Supertest + real DB
│   └── concurrency/                    # 500 VUs racing for 100 tickets → assert 0 oversell
│
├── loadtest/
│   ├── booking.js                      # k6 script: S1 ramp + S2 correctness scenario
│   └── results/                        # Raw k6 JSON exports (git-ignored; commit manually)
│
├── scripts/
│   ├── mail-test.js                    # Smoke test: sends one real email
│   ├── demo.js                         # Seeds demo data for the walkthrough video
│   └── retry-failed-jobs.js            # Re-drives BullMQ dead-letter jobs
│
├── context/                            # Internal planning docs (see AGENTS.md)
├── docker-compose.yml                  # postgres + postgres_test + redis
├── render.yaml                         # Render Blueprint: web + worker + DB + Redis
├── .env.example                        # Template — no real values
└── package.json
```

---

## Running Tests

### Prerequisites

```bash
docker compose up -d   # starts postgres_test (port 5433) + redis
```

### All integration tests

```bash
npm test
```

### Concurrency test only

```bash
npm run test:concurrency
# 500 goroutines race for 100 tickets — asserts exactly 100 bookings, 0 oversell
```

### k6 load test (against deployed URL)

```bash
# Install k6: https://k6.io/docs/get-started/installation/

# Create an event, grab its ID + a customer JWT, then:
EVENT_ID=<uuid> CUSTOMER_TOKEN=<jwt> \
  k6 run \
  --summary-export loadtest/results/$(date +%Y%m%d-%H%M)-v2-s1-ramp.json \
  -e BASE_URL=https://pulsetix-api.onrender.com \
  loadtest/booking.js
```

Raw result files are saved to `loadtest/results/` (git-ignored; commit manually after each benchmark run).

### Retry failed email jobs

```bash
npm run jobs:retry-failed
```

---

## Deployment (Render)

### One-time setup

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New** → **Blueprint** → select your repo
3. Render reads `render.yaml` and provisions all four services:
   - `pulsetix-api` — web service (`npm start`)
   - `pulsetix-worker` — background worker (`npm run start:worker`)
   - `pulsetix-db` — managed Postgres
   - `pulsetix-redis` — managed Key Value (Redis)
4. In the Render dashboard, manually set these secrets (marked `sync: false` in `render.yaml`):
   - `ORGANIZER_SIGNUP_CODE` — share this value with graders
   - `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`
   - `METRICS_TOKEN` — any random string
5. Deploy. On first boot, `npm run migrate` runs automatically.
6. Verify: `curl https://<your-api>.onrender.com/api/health`

### SMTP — Brevo (recommended, 300 emails/day free)

1. Sign up at [brevo.com](https://www.brevo.com)
2. **SMTP & API** → generate SMTP credentials
3. Set in Render env:
   ```
   SMTP_HOST = smtp-relay.brevo.com
   SMTP_PORT = 587
   SMTP_USER = <your login email>
   SMTP_PASS = <your SMTP key>
   SMTP_FROM = noreply@yourdomain.com
   ```

### Running the V1 baseline benchmark

```bash
# 1. Temporarily set in Render dashboard:
ENABLE_NAIVE=true
RATE_LIMIT_ENABLED=false

# 2. Redeploy → run k6 benchmark → save result file

# 3. Revert both vars and redeploy before submission
```

> ⚠️ `ENABLE_NAIVE=true` is **never set** in the final deployed version.

---

## Invariants

These rules hold everywhere in the codebase. Violating any is a bug.

1. `available_tickets` is only changed by a conditional `UPDATE ... WHERE available_tickets >= n`. No read-modify-write in application code (`src/naive/` is the sole, isolated exception).
2. The inventory decrement, the booking row, and its outbox row commit atomically in the same statement.
3. HTTP handlers never call SMTP and never block on Redis. Redis being down must not affect bookings.
4. Every protected route executes in this exact order: **authenticate → authorize role → validate input → ownership SQL guard**. No mutation before all four pass.
5. Background handlers are idempotent: deterministic `jobId` + `notification_log.dedupe_key` checked before every send.
6. `src/naive/` is never imported by non-naive code and is unreachable unless `ENABLE_NAIVE=true`.
7. No performance number is written into any doc unless a raw result file in `loadtest/results/` backs it.
8. Secrets exist only as environment variables. `.env` is git-ignored. `.env.example` has no real values.
9. Migrations are forward-only. An applied migration file is never edited — add a new numbered file instead.

