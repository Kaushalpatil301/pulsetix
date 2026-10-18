# Performance Plan and Results Log

Purpose: produce honest, reproducible evidence for the three mandatory video points: (1) V1 breaking point, (2) optimizations, (3) final V2 limits.

## Definitions (fixed BEFORE testing)
- **Degraded / breaking point** = the first VU level where ANY holds: `http_req_failed > 1%`, `p95 > 1000 ms`, or requests time out/are dropped (`dropped_iterations` or connection errors).
- **Highest passing concurrency** = the highest VU level that passed all thresholds in BOTH repeat runs.
- **Booking workload** = each VU loops `POST /book` with a fresh unique Idempotency-Key, 1 ticket, from a pool of pre-registered customer tokens (registration/bcrypt is NOT in the measured path).

## Environment disclosure (fill once, repeat in README)
Render plan/instance size: __ | Postgres plan: __ | Redis: __ | Region: __ | Load generator location: __ | DB_POOL_MAX: __ | Instances: __ | Rate limit: OFF | SMTP: sandbox (Mailtrap) | Node version: __

## Scenarios
1. **S1 Flash sale (primary):** one event, huge inventory (throughput run) and a 100-ticket event (correctness run). Stages: 10 → 25 → 50 → 100 → 200 → 400 → 800 VUs, 30 s each level (plus 10 s warm-up discarded).
2. **S2 Correctness under contention:** 100 tickets, 500 VUs, 10 s. Expect exactly 100 `201`, 400 `409`. V1 is expected to oversell or error; V2 must not.
3. **S3 Event update fan-out (if time):** N customers booked, PATCH once, measure time until the last email job completes and queue drain rate.
4. **S4 Mixed (stretch):** 70% browse, 25% book, 5% PATCH.

## Run protocol (every run)
1. Fresh event with known inventory; record event id.
2. Warm-up 10 s (discarded).
3. `k6 run --summary-export loadtest/results/<YYYYMMDD-HHMM>-<version>-<scenario>-<vus>vu.json ...`
4. Immediately run the verification SQL below; paste output into the log row.
5. Repeat the run once; use the worse result.
6. Change exactly ONE thing between runs; record it in the change log.

## Verification SQL (run after every run)
```sql
-- oversold / inventory integrity (must be 0 rows for V2)
SELECT e.id, e.total_tickets, e.available_tickets,
       COALESCE(SUM(b.tickets_count),0) AS booked,
       (COALESCE(SUM(b.tickets_count),0) + e.available_tickets) - e.total_tickets AS drift
FROM events e LEFT JOIN bookings b ON b.event_id = e.id AND b.status='CONFIRMED'
WHERE e.id = :event_id GROUP BY e.id HAVING (COALESCE(SUM(b.tickets_count),0) + e.available_tickets) <> e.total_tickets
    OR e.available_tickets < 0;
-- duplicate bookings (must be 0 rows)
SELECT customer_id, idempotency_key, COUNT(*) FROM bookings GROUP BY 1,2 HAVING COUNT(*) > 1;
-- outbox backlog after run
SELECT COUNT(*) FROM outbox_events WHERE processed_at IS NULL;
```
(V1 has no idempotency key: for V1 report `booked > total_tickets` as oversold = booked - total.)

## Metrics captured per run
VUs, total requests, req/s, p50/p95/p99, http_req_failed %, timeouts, 201 count, 409 count, oversold, duplicates, pool waiting count (from `/metrics`), queue depth, outbox backlog, CPU/RAM from the hosting dashboard.

## Optimization ladder (apply in this order, one per run)
| # | Change | Hypothesis | Evidence to look for |
|---|---|---|---|
| 0 | V1 as built (read-then-write, inline SMTP, pool=5) | Fails by lost updates, long latency tied to SMTP, pool starvation | oversold > 0, p95 explodes, errors |
| 1 | Email out of request path (queue/outbox) | Removes external latency from the critical path | p95 drops sharply |
| 2 | Atomic single-statement booking + CHECK | Removes race and extra round trips; oversold = 0 | drift = 0, fewer DB round trips |
| 3 | Idempotency + outbox in same statement | Correctness cost should be small | compare req/s to run 2 |
| 4 | Pool size tuning (stay below DB max connections) | Less queueing at the pool | `/metrics` pool waiting → 0 |
| 5 | Index review (`EXPLAIN ANALYZE` the booking and list queries) | Eliminates seq scans | plan change, lower DB time |
| 6 | 2+ API instances | Node is single-threaded | linear-ish gain until DB/hot row limits |
| 7 | Cache `GET /events` (5 s TTL) | Browsing stops competing with booking | S4 mixed traffic improves |
| 8 | Hot-row mitigation (documented, only built if time): shard inventory into N counters | Single event row is the ceiling | explain why throughput flattens |
| V3 | Redis Lua admission control (documented ONLY) | Cuts DB contention for sold-out rejections | future work; needs reconciliation/crash recovery, so not built |

## Change log (fill with real data only)
| Run ID | Version | Change vs previous | VUs | req/s | p95 ms | p99 ms | err % | 201 / 409 | Oversold | Duplicates | Result file |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | |

## Final benchmark table (copied into README; numbers must trace to the log above)
| Metric | V1 | V2 | V3 |
|---|---|---|---|
| Highest passing concurrency | | | not built |
| Throughput (req/s) | | | |
| p95 latency | | | |
| Error rate | | | |
| Oversold tickets | | 0 | |
| Duplicate bookings | | 0 | |

## Known limits to state honestly in the README/video
- Free/low-tier CPU, RAM and DB connection caps set the absolute numbers; relative improvement is the point.
- Load generator location/bandwidth can be the bottleneck; say where it ran.
- A single hot event row serializes writers; this is the architectural ceiling of V2.
- Email throughput is bounded by the SMTP provider, which is why delivery is async and rate-limited.

## Video evidence checklist
1. V1: terminal showing k6 ramp; the level where `http_req_failed`/timeouts appear; the oversold SQL result.
2. Optimizations: the ladder table + one sentence on why each change helped (use the measured delta).
3. V2: same k6 script, higher level passing, drift query = 0, email arriving in inbox, queue/outbox drained.
