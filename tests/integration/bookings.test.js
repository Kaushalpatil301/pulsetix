import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { query } from '../../src/db/pool.js';

const app = buildApp();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeOrganizer() {
  const res = await request(app).post('/api/auth/register').send({
    name: 'Org',
    email: `org-b-${Date.now()}-${Math.random()}@test.com`,
    password: 'Password1!',
    role: 'ORGANIZER',
    organizer_code: 'TEST_ORG_CODE',
  });
  return res.body.token;
}

async function makeCustomer() {
  const res = await request(app).post('/api/auth/register').send({
    name: 'Cust',
    email: `cust-b-${Date.now()}-${Math.random()}@test.com`,
    password: 'Password1!',
    role: 'CUSTOMER',
  });
  return res.body.token;
}

async function createEvent(orgToken, overrides = {}) {
  const res = await request(app)
    .post('/api/events')
    .set('Authorization', `Bearer ${orgToken}`)
    .send({
      title: 'Test Event',
      venue: 'Arena',
      event_date: new Date(Date.now() + 86400000 * 7).toISOString(),
      price_cents: 1000,
      total_tickets: 100,
      ...overrides,
    });
  return res.body.id;
}

async function book(custToken, eventId, idempotencyKey, ticketsCount = 1) {
  return request(app)
    .post(`/api/events/${eventId}/book`)
    .set('Authorization', `Bearer ${custToken}`)
    .set('Idempotency-Key', idempotencyKey)
    .send({ tickets_count: ticketsCount });
}

// ── Booking: basic flow ───────────────────────────────────────────────────────

describe('POST /api/events/:id/book', () => {
  it('returns 201 for a new booking', async () => {
    const orgToken = await makeOrganizer();
    const custToken = await makeCustomer();
    const eventId = await createEvent(orgToken);

    const res = await book(custToken, eventId, 'unique-key-12345678', 2);
    expect(res.status).toBe(201);
    expect(res.body.tickets_count).toBe(2);
    expect(res.body.status).toBe('CONFIRMED');
    expect(res.body.total_cents).toBe(2000);
  });

  it('outbox row is created in same transaction as booking', async () => {
    const orgToken = await makeOrganizer();
    const custToken = await makeCustomer();
    const eventId = await createEvent(orgToken);

    await book(custToken, eventId, 'outbox-key-12345678', 1);

    const { rows } = await query(
      `SELECT COUNT(*)::int AS cnt FROM outbox_events WHERE event_type = 'booking_confirmed'`,
    );
    expect(rows[0].cnt).toBe(1);
  });

  it('available_tickets decrements correctly', async () => {
    const orgToken = await makeOrganizer();
    const custToken = await makeCustomer();
    const eventId = await createEvent(orgToken, { total_tickets: 10 });

    await book(custToken, eventId, 'avail-key-12345678', 3);

    const { rows } = await query(
      'SELECT available_tickets FROM events WHERE id = $1',
      [eventId],
    );
    expect(rows[0].available_tickets).toBe(7);
  });

  it('returns 409 SOLD_OUT when tickets are exhausted', async () => {
    const orgToken = await makeOrganizer();
    const custToken = await makeCustomer();
    const eventId = await createEvent(orgToken, { total_tickets: 2 });

    await book(custToken, eventId, 'sold-key-1111111111', 2); // uses all
    const res = await book(custToken, eventId, 'sold-key-2222222222', 1);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SOLD_OUT');
    expect(res.body.error.details.available).toBe(0);
  });

  it('requires Idempotency-Key header → 400 VALIDATION_ERROR', async () => {
    const custToken = await makeCustomer();
    const res = await request(app)
      .post('/api/events/00000000-0000-0000-0000-000000000000/book')
      .set('Authorization', `Bearer ${custToken}`)
      .send({ tickets_count: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('tickets_count must be 1–10 → 400', async () => {
    const custToken = await makeCustomer();
    const orgToken = await makeOrganizer();
    const eventId = await createEvent(orgToken);

    const res = await book(custToken, eventId, 'tc-key-111111111', 11);
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent event', async () => {
    const custToken = await makeCustomer();
    const res = await book(custToken, '00000000-0000-0000-0000-000000000000', 'notfound-key-123456');
    expect(res.status).toBe(404);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('Booking idempotency', () => {
  it('same (customer, idempotency-key, payload) → 200 with original booking, no second outbox row', async () => {
    const orgToken = await makeOrganizer();
    const custToken = await makeCustomer();
    const eventId = await createEvent(orgToken);

    const res1 = await book(custToken, eventId, 'idem-key-12345678', 2);
    expect(res1.status).toBe(201);
    const bookingId = res1.body.id;

    const res2 = await book(custToken, eventId, 'idem-key-12345678', 2);
    expect(res2.status).toBe(200);
    expect(res2.body.id).toBe(bookingId); // same booking
    expect(res2.body.tickets_count).toBe(2);

    // Only ONE outbox row
    const { rows } = await query(
      `SELECT COUNT(*)::int AS cnt FROM outbox_events WHERE event_type = 'booking_confirmed'`,
    );
    expect(rows[0].cnt).toBe(1);

    // Only ONE booking row
    const { rows: bookingRows } = await query(
      `SELECT COUNT(*)::int AS cnt FROM bookings WHERE customer_id = (
         SELECT id FROM users WHERE email LIKE 'cust%' LIMIT 1
       )`,
    );
    expect(bookingRows[0].cnt).toBe(1);
  });

  it('same key, different tickets_count → 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const orgToken = await makeOrganizer();
    const custToken = await makeCustomer();
    const eventId = await createEvent(orgToken);

    await book(custToken, eventId, 'conflict-key-123456', 2);
    const res = await book(custToken, eventId, 'conflict-key-123456', 3); // different count

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

// ── GET /api/bookings/me ──────────────────────────────────────────────────────

describe('GET /api/bookings/me', () => {
  it('returns customer own bookings with event details', async () => {
    const orgToken = await makeOrganizer();
    const custToken = await makeCustomer();
    const eventId = await createEvent(orgToken);

    await book(custToken, eventId, 'me-key-1234567890', 1);

    const res = await request(app)
      .get('/api/bookings/me')
      .set('Authorization', `Bearer ${custToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].event_title).toBeTruthy();
  });

  it('organizer cannot call /bookings/me → 403', async () => {
    const orgToken = await makeOrganizer();
    const res = await request(app)
      .get('/api/bookings/me')
      .set('Authorization', `Bearer ${orgToken}`);
    expect(res.status).toBe(403);
  });
});
