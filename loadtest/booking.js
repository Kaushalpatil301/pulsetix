/**
 * PulseTix k6 Load Test — Flash Sale Scenario
 *
 * Scenarios:
 *  S1: Throughput ramp — staged VU increase to find breaking point
 *  S2: Correctness — 500 VUs on 100-ticket event (run separately)
 *
 * Usage:
 *   # S1 ramp (primary benchmark):
 *   k6 run --summary-export loadtest/results/YYYYMMDD-HHMM-v2-s1-ramp.json loadtest/booking.js
 *
 *   # S2 correctness (override env):
 *   k6 run -e SCENARIO=correctness --summary-export loadtest/results/YYYYMMDD-HHMM-v2-s2-correctness.json loadtest/booking.js
 *
 *   # Target deployed URL:
 *   k6 run -e BASE_URL=https://pulsetix.onrender.com loadtest/booking.js
 *
 * Pre-requisites (run once before each benchmark):
 *   1. Create a fresh event and set EVENT_ID env var
 *   2. Pre-register a pool of customer tokens (or use the single CUSTOMER_TOKEN below)
 *   3. Ensure RATE_LIMIT_ENABLED=false and SMTP pointed at Mailtrap sandbox
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const EVENT_ID = __ENV.EVENT_ID || 'REPLACE_WITH_EVENT_ID';
const CUSTOMER_TOKEN = __ENV.CUSTOMER_TOKEN || 'REPLACE_WITH_CUSTOMER_TOKEN';
const SCENARIO = __ENV.SCENARIO || 'ramp';

// ── Custom metrics ────────────────────────────────────────────────────────────
const bookingSuccess = new Counter('booking_success_201');
const bookingSoldOut = new Counter('booking_sold_out_409');
const bookingErrors  = new Counter('booking_errors_other');
const bookingLatency = new Trend('booking_latency_ms', true);
const errorRate      = new Rate('error_rate');

// ── Thresholds (breaking point = first level where these fail) ────────────────
export const options = SCENARIO === 'correctness'
  ? {
      // S2: 500 VUs, 10 s — correctness run
      vus: 500,
      duration: '10s',
      thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<1000'],
      },
    }
  : {
      // S1: Staged ramp — 10→25→50→100→200→400→800 VUs, 30 s each
      stages: [
        { duration: '10s', target: 10  },  // warm-up (discarded)
        { duration: '30s', target: 10  },
        { duration: '30s', target: 25  },
        { duration: '30s', target: 50  },
        { duration: '30s', target: 100 },
        { duration: '30s', target: 200 },
        { duration: '30s', target: 400 },
        { duration: '30s', target: 800 },
        { duration: '10s', target: 0   },  // cool-down
      ],
      thresholds: {
        http_req_failed:   ['rate<0.01'],   // < 1% failed
        http_req_duration: ['p(95)<1000'],  // p95 < 1 s
        error_rate:        ['rate<0.01'],
      },
    };

// ── Main VU function ──────────────────────────────────────────────────────────
export default function () {
  // Each iteration uses a unique Idempotency-Key
  const idempotencyKey = `vu-${__VU}-iter-${__ITER}-${Date.now()}`;

  const url = `${BASE_URL}/api/events/${EVENT_ID}/book`;
  const payload = JSON.stringify({ tickets_count: 1 });
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CUSTOMER_TOKEN}`,
      'Idempotency-Key': idempotencyKey,
    },
    timeout: '5s',
  };

  const start = Date.now();
  const res = http.post(url, payload, params);
  bookingLatency.add(Date.now() - start);

  if (res.status === 201) {
    bookingSuccess.add(1);
    errorRate.add(0);
    check(res, { 'booking confirmed (201)': (r) => r.status === 201 });
  } else if (res.status === 409) {
    bookingSoldOut.add(1);
    errorRate.add(0);
    check(res, { 'sold out (409)': (r) => r.status === 409 });
  } else {
    bookingErrors.add(1);
    errorRate.add(1);
    check(res, { 'unexpected error': () => false });
  }

  sleep(0.1); // small think time
}

export function handleSummary(data) {
  // eslint-disable-next-line no-undef
  return {
    stdout: JSON.stringify(data, null, 2),
  };
}
