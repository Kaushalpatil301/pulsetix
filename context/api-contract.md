# API Contract (replaces ui-context.md — this project has no UI)

This file is the single source of truth for the HTTP surface. Change it BEFORE changing a route.

## Conventions
- Base path `/api`. JSON in/out, UTF-8. Times are ISO-8601 UTC strings. Money is integer cents (`price_cents`, `total_cents`).
- Auth header: `Authorization: Bearer <jwt>`.
- Every response carries `X-Request-Id` (echoed from the request if provided, else generated).
- Field naming: `snake_case` in JSON.
- Success shapes: single resource → the object; list → `{ "data": [...], "limit": n, "offset": n }`.
- Error shape (always): `{ "error": { "code": "STRING_CODE", "message": "human text", "details": { ... }? } }`

## Error codes
| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | body/query/header failed zod validation (`details` = field errors) |
| 401 | `UNAUTHENTICATED` | missing/invalid/expired token, bad login |
| 403 | `FORBIDDEN` | wrong role, not the owner, bad organizer signup code |
| 404 | `NOT_FOUND` | resource missing (also used when a non-owner probes an event id) |
| 409 | `SOLD_OUT` | fewer than `tickets_count` tickets remain (`details.available`) |
| 409 | `EVENT_STARTED` | event_date has passed |
| 409 | `IDEMPOTENCY_KEY_REUSED` | same key, different payload |
| 409 | `EMAIL_TAKEN` | duplicate registration |
| 409 | `CAPACITY_BELOW_SOLD` | PATCH lowers total_tickets under tickets already sold |
| 429 | `RATE_LIMITED` | auth routes (and per-user booking limit when enabled) |
| 500 | `INTERNAL` | unexpected; never leaks internals |

## Endpoints
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | `{name, email, password(>=8), role, organizer_code?}` → 201 `{user, token}` |
| POST | `/auth/login` | public | `{email, password}` → 200 `{user, token}` |
| GET | `/events` | public | upcoming only; `?limit<=100&offset` ; ordered by event_date |
| GET | `/events/:id` | public | includes `available_tickets` |
| POST | `/events` | ORGANIZER | `{title, description?, venue, event_date(future), price_cents>=0, total_tickets>0}` → 201 |
| PATCH | `/events/:id` | owning ORGANIZER | any subset of the create fields; at least one; 200 updated event |
| GET | `/events/:id/bookings` | owning ORGANIZER | latest 500 bookings with customer name/email |
| POST | `/events/:id/book` | CUSTOMER | header `Idempotency-Key` (8–64 chars) required; body `{tickets_count: 1..10}` |
| GET | `/bookings/me` | CUSTOMER | own bookings with event summary, newest first |
| GET | `/health` | public | `{ok:true}`; also checks DB with `SELECT 1` |
| GET | `/metrics` | `x-metrics-token` header | pool total/idle/waiting, queue counts (waiting/active/failed), outbox backlog, uptime |
| POST | `/events/:id/book-naive` | CUSTOMER, only if `ENABLE_NAIVE=true` | V1 baseline for the benchmark; same body, no idempotency |

## Booking semantics
- `201` new booking: `{id, event_id, customer_id, tickets_count, total_cents, status:"CONFIRMED", created_at}`.
- `200` same `(customer, Idempotency-Key)` and same payload: returns the ORIGINAL booking, creates nothing, sends no second email.
- Same key + different `tickets_count` or `event_id` → `409 IDEMPOTENCY_KEY_REUSED`.
- Inventory failure never leaves partial state (single statement).
- Response is sent as soon as the DB commit succeeds; email is asynchronous.

## PATCH semantics
- Only the owner may update; non-owner gets 404 (do not reveal existence) — decision recorded in architecture/progress tracker.
- Emails are triggered only if title, description, venue, event_date or price changed. A capacity-only change sends nothing.
- `total_tickets` change recomputes `available_tickets = new_total - sold`; below sold → 409.

## Rate limiting
- `/auth/*`: 20 req/min/IP. Booking per-user limit: configurable via `BOOKING_RATE_LIMIT_PER_MIN`.
- `RATE_LIMIT_ENABLED=false` for benchmark runs; the benchmark report must state that it was off.

## Notification contents (what graders will read)
- Confirmation: booking id, event title, venue, date/time, tickets, total, status.
- Update: event title and a before → after list of every changed field, plus current event details.
