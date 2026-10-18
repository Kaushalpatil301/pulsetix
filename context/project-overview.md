# PulseTix

## Overview
PulseTix is a backend-only REST API for event booking. Event organizers create and manage events; customers browse events
and book tickets. The system must stay correct when hundreds of customers compete for limited inventory (a flash sale),
send real emails asynchronously, and come with measured evidence of how many concurrent bookers it handles before and
after optimization. It is built as an engineering showcase / assignment submission, not a commercial product.

## Goals
1. Zero oversold tickets and zero duplicate bookings under concurrent load (verified by SQL after every load run).
2. Booking confirmation and event-update emails are really delivered, never block an HTTP response, and survive worker or Redis failure (outbox + retries).
3. Find V1's breaking point (first concurrency level where http_req_failed > 1% OR p95 > 1000 ms) and move it measurably with V2; report both honestly.
4. Deployed publicly (API + worker + Postgres + Redis) and demonstrable end-to-end from a single deployed URL.
5. Every design decision, rejected alternative and trade-off is written down in the README.

## Core User Flows
Organizer: register (with signup code) → login → create event → update event (customers get emailed) → view bookings for own event.
Customer: register → login → browse events → book N tickets with an Idempotency-Key → receive confirmation email → view own bookings.
Evaluator: run the k6 flash-sale script against the deployed URL → read the benchmark table → watch the demo video.

## Features
### Identity and access
- JWT auth, bcrypt-hashed passwords, roles ORGANIZER / CUSTOMER, role + ownership enforcement on every protected route.
### Events
- Create / update (PATCH) / list (paginated, upcoming only) / get; organizer can list bookings for events they own.
### Booking
- Atomic inventory reservation, 1–10 tickets per request, idempotent retries, 409 when sold out.
### Background work
- Task A: booking confirmation email. Task B: event-update notification to every customer with a confirmed booking.
- Transactional outbox → BullMQ → worker → SMTP, with exponential-backoff retries, rate limiting and duplicate protection.
### Performance engineering
- V1 naive baseline (isolated), V2 correct + optimized, k6 scripts, raw results, benchmark report. V3 (Redis admission control) is documented as future work, NOT built.

## Scope
### In scope
- Everything above, automated tests (auth/RBAC, integration, concurrency), k6 flash-sale scenario, README + docs, 3–4 min demo video.
### Out of scope
- Frontend, payments, refunds/cancellations, seat selection, QR codes, microservices/Kubernetes, V3 implementation, OpenAPI generation, CI pipelines.

## Hard assignment constraints (cannot be traded away)
- Emails must be real (console.log does not count) for BOTH tasks.
- Role-based access control on the API.
- Deployed online (Render). Demo video 3–4 min, face visible, spoken English, using the deployed URL.
- The video must SHOW: (1) V1 breaking point with dropped/failed requests, (2) explanation of optimizations, (3) final optimized limits.

## Success Criteria
1. A customer calling any organizer route gets 403; an organizer editing another organizer's event gets 403/404 (tested).
2. 500 concurrent single-ticket requests on a 100-ticket event produce exactly 100 bookings and available_tickets = 0 (tested, and shown live).
3. Re-sending a booking with the same Idempotency-Key returns the original booking (200) and creates no second row (tested).
4. Booking → email arrives in a real inbox; PATCH on an event → every booked customer gets an email (shown in demo).
5. Killing the worker mid-run loses no emails after restart (outbox recovery; tested or demonstrated).
6. `performance-plan.md` contains measured V1 and V2 rows backed by files in `loadtest/results/`.
