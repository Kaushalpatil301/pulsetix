# PulseTix — Event Booking API

A backend-only, high-concurrency event booking REST API built as an engineering assignment.
Grades on: correctness under load · real background emails · deployment · measured performance story.

**Live API:** `https://pulsetix-api.onrender.com` *(fill after deploy)*
**Demo Video:** *(fill Loom link after recording)*

---

## Table of Contents
1. [Quick Start](#quick-start)
2. [API Reference](#api-reference)
3. [Background Tasks](#background-tasks)
4. [Performance Results](#performance-results)
5. [Architecture & Design Decisions](#architecture--design-decisions)
6. [Deployment Guide](#deployment-guide)
7. [Running Tests](#running-tests)

---

## Quick Start

### Prerequisites
- Node.js ≥ 20
- Docker Desktop (for local Postgres + Redis)

### 1. Clone and install
```bash
git clone <your-repo-url>
cd Event
npm install
```

### 2. Environment
```bash
cp .env.example .env
# Edit .env — fill JWT_SECRET (≥32 chars), ORGANIZER_SIGNUP_CODE, SMTP_* credentials
```

### 3. Start infrastructure
```bash
docker compose up -d
```

### 4. Run migrations
```bash
npm run migrate
```

### 5. Start API + worker
```bash
# Terminal 1
npm run dev

# Terminal 2
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
```

---

## API Reference

Base path: `/api`. All requests/responses are JSON. Times are ISO-8601 UTC. Money is integer cents.

### Auth header
```
Authorization: Bearer <jwt>
```

### Error shape (always)
```json
{ "error": { "code": "STRING_CODE", "message": "human text", "details": {} } }
```

### Endpoints

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| `POST` | `/auth/register` | Public | Register. Body: `{name, email, password(≥8), role, organizer_code?}` → 201 `{user, token}` |
| `POST` | `/auth/login` | Public | Login. Body: `{email, password}` → 200 `{user, token}` |
| `GET` | `/events` | Public | List upcoming events. Query: `?limit≤100&offset` |
| `GET` | `/events/:id` | Public | Get event (includes `available_tickets`) |
| `POST` | `/events` | ORGANIZER | Create event. Body: `{title, description?, venue, event_date, price_cents, total_tickets}` |
| `PATCH` | `/events/:id` | Owning ORGANIZER | Update event (any subset of create fields; ≥1 required) |
| `GET` | `/events/:id/bookings` | Owning ORGANIZER | Latest 500 bookings with customer name/email |
| `POST` | `/events/:id/book` | CUSTOMER | Book tickets. Header: `Idempotency-Key` (8–64 chars). Body: `{tickets_count: 1..10}` |
| `GET` | `/bookings/me` | CUSTOMER | Own bookings with event summary, newest first |
| `GET` | `/health` | Public | `{ok: true}`. Also checks DB with `SELECT 1` |
| `GET` | `/metrics` | `x-metrics-token` header | Pool stats, outbox backlog, uptime |
| `POST` | `/events/:id/book-naive` | CUSTOMER (`ENABLE_NAIVE=true` only) | V1 baseline — never enable in production |

### Error codes
| HTTP | Code | When |
|------|------|------|
| 400 | `VALIDATION_ERROR` | Body/query/header failed zod validation |
| 401 | `UNAUTHENTICATED` | Missing/invalid/expired token, bad login |
| 403 | `FORBIDDEN` | Wrong role, not the owner, bad organizer signup code |
| 404 | `NOT_FOUND` | Resource missing (also: non-owner probing an event) |
| 409 | `SOLD_OUT` | Fewer than `tickets_count` tickets remain |
| 409 | `EVENT_STARTED` | Event date has passed |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Same key, different payload |
| 409 | `EMAIL_TAKEN` | Duplicate registration |
| 409 | `CAPACITY_BELOW_SOLD` | PATCH lowers `total_tickets` under tickets already sold |
| 429 | `RATE_LIMITED` | Auth routes: 20 req/min/IP |
| 500 | `INTERNAL` | Unexpected error (never leaks internals) |

### Booking semantics
- `201` — new booking
- `200` — same `(customer_id, Idempotency-Key)` + same payload → returns original booking, no second email
- Same key + different `tickets_count` → `409 IDEMPOTENCY_KEY_REUSED`
- Response sent immediately after DB commit; email is asynchronous

### Organizer registration
Set `ORGANIZER_SIGNUP_CODE` in your `.env`. Pass it as `organizer_code` in the register body.
**Grader code:** *(fill after deploy — share in submission)*

---

## Background Tasks

### Task 1 — Booking Confirmation Email
**Trigger:** Customer successfully books tickets  
**Delivery:** Real SMTP email (Brevo/Gmail) — not console.log  
**Flow:**
```
POST /book → atomic CTE (booking + outbox row in same DB transaction)
           → outbox dispatcher (polls every 1 s, FOR UPDATE SKIP LOCKED)
           → BullMQ job enqueued (jobId = outbox row id)
           → Worker: load booking/user/event → send Nodemailer email → notification_log
```
**Crash-safe:** Outbox row survives worker crash. On restart, dispatcher re-enqueues; `notification_log.dedupe_key` prevents double-send.

**Email contains:** Booking ID, event title, venue, date/time, tickets count, total paid, status.

### Task 2 — Event Update Notification
**Trigger:** Organizer PATCHes a customer-visible field (title, description, venue, event_date, price)  
**Delivery:** Real SMTP email to every customer with a confirmed booking — not console.log  
**Flow:**
```
PATCH /events/:id → UPDATE events + INSERT outbox_events (same transaction)
                  → Dispatcher → BullMQ job (event_updated)
                  → Worker: pages through booked customers in batches of 100
                           → enqueues per-recipient jobs (jobId = eu:{eventId}:{version}:{customerId})
                           → each job: send email → notification_log
```
**Idempotent:** Deterministic `jobId` prevents duplicate fan-out. `notification_log.dedupe_key` prevents double-send on retry.  
**Email contains:** Changed fields (before → after), current event details.

---

## Performance Results

> ⚠️ Numbers will be filled after benchmark runs. See `context/performance-plan.md` for the protocol.

### Environment
| Parameter | Value |
|-----------|-------|
| Hosting | Render free tier |
| DB | Render Postgres (free) |
| Redis | Render Key Value (free) |
| Region | Oregon (us-west) |
| Load generator | *fill* |
| `DB_POOL_MAX` | 10 |
| `RATE_LIMIT_ENABLED` | false (during benchmarks) |
| SMTP | Mailtrap sandbox (during load tests) |

### Benchmark Table

| Metric | V1 (Naive) | V2 (Optimized) |
|--------|-----------|----------------|
| Highest passing concurrency | *run pending* | *run pending* |
| Throughput (req/s) | | |
| p95 latency | | |
| Error rate | | |
| Oversold tickets | *expected >0* | 0 |
| Duplicate bookings | *expected >0* | 0 |

### Optimization Ladder

| # | Change | Effect |
|---|--------|--------|
| 0 | V1: read-then-write + inline SMTP + pool=5 | Race conditions, slow (SMTP in request path) |
| 1 | Email out of request path (outbox + worker) | p95 drops sharply — SMTP latency removed |
| 2 | Atomic single-statement booking CTE + CHECK | Oversell = 0; fewer DB round trips |
| 3 | Idempotency + outbox in same statement | Correctness cost is small vs gain |
| 4 | Pool size tuning | Pool waiting → 0 at `/metrics` |
| 5 | Index review (EXPLAIN ANALYZE) | Eliminates seq scans on booking path |
| 6 | 2+ API instances | Near-linear gain until DB hot-row limit |
| 7 | Cache `GET /events` (5 s TTL) | Browse traffic stops competing with bookings |
| V3 (not built) | Redis Lua admission control | Cuts DB contention for sold-out; needs crash recovery — out of scope |

---

## Architecture & Design Decisions

### Stack
| Layer | Technology | Decision |
|-------|------------|----------|
| Runtime | Node.js 20, CommonJS | Existing scaffold; speed of delivery > TypeScript type-safety for this assignment |
| HTTP | Express 4 | Minimal, battle-tested, no magic |
| Database | PostgreSQL 15 via `pg` (raw SQL) | Booking must be ONE atomic statement; ORMs hide the SQL and add overhead |
| Queue | Redis + BullMQ | Durable job execution, retries, rate limiting built-in |
| Email | Nodemailer + SMTP | Real delivery; pluggable provider (Brevo/Gmail/Mailtrap) |
| Validation | zod | Schema inference + runtime safety at every boundary |
| Auth | JWT (12h) + bcryptjs | Stateless; role in token means no DB hit per request |

### Key Design Decisions

#### 1. Raw SQL over ORM
**Decision:** `pg` with parameterized queries everywhere.  
**Why:** The booking is a single atomic CTE (`UPDATE events + INSERT bookings + INSERT outbox_events`). An ORM would require 3 round trips and an explicit transaction, expanding the lock window. The SQL is also visible in the demo video.  
**Rejected:** Prisma (hides SQL, requires schema generation), Knex (query builder but doesn't save the CTE pattern), Sequelize.

#### 2. Single-statement booking CTE
**Decision:** One `WITH ... UPDATE ... INSERT bookings ... INSERT outbox_events` statement.  
**Why:** 
- Minimum lock window on the event row (shorter window = more concurrent throughput)
- Atomic: decrement + booking + outbox either all commit or all roll back
- `23505` unique violation on the idempotency key rolls back the entire CTE including the decrement — the concurrent twin already won, so we just re-read and return 200
- No explicit `BEGIN/COMMIT` needed (reduces round trips)

**Alternative considered:** Explicit transaction with `SELECT FOR UPDATE` → more readable but 3× more round trips.

#### 3. Transactional outbox pattern
**Decision:** Outbox row is inserted in the same statement as the booking. Dispatcher polls and enqueues to BullMQ.  
**Why:** Closes the crash window between "booking committed" and "job enqueued to Redis". If the API crashes after commit but before enqueue, the outbox row survives. On restart, the dispatcher picks it up.  
**Alternative considered:** Direct BullMQ enqueue after commit → loses the job on crash between commit and enqueue.

#### 4. Non-owner PATCH returns 404 (not 403)
**Decision:** `WHERE id=$1 AND organizer_id=$2` returns 0 rows → 404.  
**Why:** 403 reveals that the event exists. 404 is less information to a potential attacker. Recorded in progress-tracker.md per code-standards.md.

#### 5. Organizer signup code
**Decision:** `ORGANIZER_SIGNUP_CODE` env var, required in register body for `role: ORGANIZER`.  
**Why:** Satisfies "no free privileged roles" without building a full invitation system. Graders share the code out-of-band.  
**Rejected:** Admin-only promotion endpoint (more complexity, same security).

#### 6. Fan-out per recipient with deterministic jobIds
**Decision:** One BullMQ job per booked customer (`jobId = eu:{eventId}:{version}:{customerId}`).  
**Why:** Isolated retries — one failing SMTP delivery doesn't block others. Deterministic IDs prevent duplicate fan-out on dispatcher retry. `notification_log.dedupe_key` prevents double-send even if the job is retried after SMTP succeeded.  
**Rejected:** Single job that sends to all recipients — one failure retries all.

#### 7. V3 (Redis Lua admission control) documented but not built
**Decision:** Documented in performance-plan.md as future work.  
**Why:** Needs reservation reconciliation (what if the Lua script runs but the booking CTE fails?) and crash recovery. Cannot be proven correct in the available time.

#### 8. JavaScript (not TypeScript)
**Decision:** CommonJS JavaScript throughout.  
**Why:** Existing scaffold is JS; TypeScript migration costs ≥4h; that time is better spent on benchmark evidence and the video. JSDoc typedefs provide lightweight type hints.

#### 9. Separate API and worker processes
**Decision:** `src/server.js` (API) and `src/worker.js` (worker) are separate OS processes on Render.  
**Why:** Worker can crash without taking down the API. Worker can be scaled independently. HTTP handlers never call SMTP (invariant #3 in architecture.md).

---

## Deployment Guide (Render)

### One-time setup

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New Blueprint** → select repo
3. Render reads `render.yaml` and creates all 4 services automatically
4. In the Render dashboard, manually set these secrets (marked `sync: false`):
   - `ORGANIZER_SIGNUP_CODE` — pick a code to share with graders
   - `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` — your Brevo credentials
5. Deploy. Watch logs: `npm run migrate` runs on first boot.
6. Test: `curl https://<your-api>.onrender.com/api/health`

### SMTP setup (Brevo — recommended)
1. Sign up at [brevo.com](https://www.brevo.com) (free: 300 emails/day)
2. Go to **SMTP & API** → copy SMTP credentials
3. Set in Render env vars: host=`smtp-relay.brevo.com`, port=587, user=your login, pass=your key

### Enabling V1 for benchmark
```
# Temporarily set in Render dashboard:
ENABLE_NAIVE=true
RATE_LIMIT_ENABLED=false
# Redeploy, run benchmark, then revert both
```

---

## Running Tests

### Unit prerequisites
```bash
docker compose up -d  # starts postgres_test + redis
```

### Run all integration tests
```bash
npm test
```

### Run concurrency test only
```bash
npm run test:concurrency
```

### Run k6 load test (against deployed URL)
```bash
# Install k6: https://k6.io/docs/get-started/installation/

# Set up: create event, grab its ID and a customer JWT
EVENT_ID=<uuid> CUSTOMER_TOKEN=<jwt> \
  k6 run --summary-export loadtest/results/$(date +%Y%m%d-%H%M)-v2-s1-ramp.json \
  -e BASE_URL=https://pulsetix-api.onrender.com \
  loadtest/booking.js
```

### Retry failed email jobs
```bash
npm run jobs:retry-failed
```

### Verification SQL (after every benchmark run)
```sql
-- No oversell (must return 0 rows for V2)
SELECT e.id, e.total_tickets, e.available_tickets,
       COALESCE(SUM(b.tickets_count),0) AS booked,
       (COALESCE(SUM(b.tickets_count),0) + e.available_tickets) - e.total_tickets AS drift
FROM events e LEFT JOIN bookings b ON b.event_id = e.id AND b.status='CONFIRMED'
WHERE e.id = '<event_id>'
GROUP BY e.id
HAVING (COALESCE(SUM(b.tickets_count),0) + e.available_tickets) <> e.total_tickets
    OR e.available_tickets < 0;

-- No duplicate bookings (must return 0 rows)
SELECT customer_id, idempotency_key, COUNT(*) 
FROM bookings GROUP BY 1,2 HAVING COUNT(*) > 1;

-- Outbox backlog after run
SELECT COUNT(*) FROM outbox_events WHERE processed_at IS NULL;
```

---

## Project Structure

```
src/
├── app.js                    # Express app (no listen)
├── server.js                 # API process entry
├── worker.js                 # Worker process entry
├── errors.js                 # AppError class
├── config/index.js           # Zod env validation (only process.env reader)
├── db/
│   ├── pool.js               # pg singleton pool
│   ├── migrate.js            # Forward-only migration runner
│   └── migrations/001_initial.sql
├── middleware/
│   ├── requestId.js authenticate.js requireRole.js validate.js
│   ├── rateLimit.js errorHandler.js
├── modules/
│   ├── auth/       routes.js service.js repo.js schemas.js
│   ├── events/     routes.js service.js repo.js schemas.js
│   └── bookings/   routes.js service.js repo.js schemas.js
├── naive/routes.js           # V1 baseline (env-gated, isolated)
├── mail/transport.js templates/bookingConfirmation.js templates/eventUpdate.js
├── queue/index.js handlers/bookingConfirmed.js handlers/eventUpdated.js
└── outbox/dispatcher.js

tests/
├── globalSetup.js            # Migrations before test run
├── setup.js                  # Truncate tables before each test
├── integration/              # auth, events, bookings tests
└── concurrency/              # 500 VUs on 100-ticket event

loadtest/
├── booking.js                # k6 S1 ramp + S2 correctness
└── results/                  # Raw JSON exports (git-ignored)
```
