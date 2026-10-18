/**
 * Concurrency test: 500 simultaneous booking requests on a 100-ticket event.
 *
 * Success criteria (from project-overview.md):
 *  - Exactly 100 bookings created (status CONFIRMED)
 *  - available_tickets = 0
 *  - SUM(tickets_count) = 100 (no oversell)
 *  - No duplicate (customer_id, idempotency_key) rows
 *
 * Uses 1 customer with 500 unique idempotency keys (1 ticket each).
 * Each request is independent; the unique constraint on idempotency key
 * means at most 1 booking per key, and the CTE prevents inventory from going negative.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { query } from '../../src/db/pool.js';

const app = buildApp();

const TOTAL_TICKETS = 100;
const CONCURRENT_REQUESTS = 500;

describe('Concurrency: 500 requests on 100-ticket event', () => {
  it(
    'produces exactly 100 confirmed bookings, 0 available_tickets, no oversell',
    async () => {
      // ── Setup ─────────────────────────────────────────────────────────────
      const orgRes = await request(app).post('/api/auth/register').send({
        name: 'Concurrency Org',
        email: `conc-org-${Date.now()}@test.com`,
        password: 'Password1!',
        role: 'ORGANIZER',
        organizer_code: 'TEST_ORG_CODE',
      });
      const orgToken = orgRes.body.token;

      const custRes = await request(app).post('/api/auth/register').send({
        name: 'Concurrency Customer',
        email: `conc-cust-${Date.now()}@test.com`,
        password: 'Password1!',
        role: 'CUSTOMER',
      });
      const custToken = custRes.body.token;

      const eventRes = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${orgToken}`)
        .send({
          title: 'Concurrency Test Event',
          venue: 'Test Arena',
          event_date: new Date(Date.now() + 86400000 * 30).toISOString(),
          price_cents: 100,
          total_tickets: TOTAL_TICKETS,
        });
      const eventId = eventRes.body.id;
      expect(eventId).toBeTruthy();

      // ── Fire 500 concurrent requests ──────────────────────────────────────
      const promises = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
        request(app)
          .post(`/api/events/${eventId}/book`)
          .set('Authorization', `Bearer ${custToken}`)
          .set('Idempotency-Key', `conc-key-${i.toString().padStart(8, '0')}`)
          .send({ tickets_count: 1 }),
      );

      const responses = await Promise.all(promises);

      // ── Count results ─────────────────────────────────────────────────────
      const statusCodes = responses.map((r) => r.status);
      const count201 = statusCodes.filter((s) => s === 201).length;
      const count409 = statusCodes.filter((s) => s === 409).length;
      const countOther = statusCodes.filter((s) => s !== 201 && s !== 409).length;

      // eslint-disable-next-line no-console
      console.log(`  201 (booked): ${count201}`);
      // eslint-disable-next-line no-console
      console.log(`  409 (sold out/idempotency): ${count409}`);
      // eslint-disable-next-line no-console
      console.log(`  Other errors: ${countOther}`);

      // ── Verify in DB ──────────────────────────────────────────────────────
      const { rows: eventRows } = await query(
        'SELECT available_tickets, total_tickets FROM events WHERE id = $1',
        [eventId],
      );
      const { rows: bookingRows } = await query(
        `SELECT COUNT(*)::int AS confirmed_count, COALESCE(SUM(tickets_count),0)::int AS total_sold
         FROM bookings WHERE event_id = $1 AND status = 'CONFIRMED'`,
        [eventId],
      );
      const { rows: dupeRows } = await query(
        `SELECT customer_id, idempotency_key, COUNT(*) FROM bookings
         WHERE event_id = $1
         GROUP BY 1,2 HAVING COUNT(*) > 1`,
        [eventId],
      );

      const available = eventRows[0].available_tickets;
      const confirmedCount = bookingRows[0].confirmed_count;
      const totalSold = bookingRows[0].total_sold;
      const dupeCount = dupeRows.length;

      // eslint-disable-next-line no-console
      console.log(`  DB: confirmed=${confirmedCount}, available=${available}, sold=${totalSold}, dupes=${dupeCount}`);

      // Core invariants
      expect(confirmedCount).toBe(TOTAL_TICKETS);      // exactly 100 bookings
      expect(available).toBe(0);                       // none left
      expect(totalSold).toBe(TOTAL_TICKETS);            // no oversell
      expect(dupeCount).toBe(0);                       // no duplicates
      expect(countOther).toBe(0);                      // no unexpected errors
      expect(count201 + count409).toBe(CONCURRENT_REQUESTS);
    },
    120000, // 2 min timeout for concurrency test
  );
});
