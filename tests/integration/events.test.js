import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';

const app = buildApp();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeOrganizer() {
  const res = await request(app).post('/api/auth/register').send({
    name: 'Organizer',
    email: `org-${Date.now()}-${Math.random()}@test.com`,
    password: 'Password1!',
    role: 'ORGANIZER',
    organizer_code: 'TEST_ORG_CODE',
  });
  return { token: res.body.token, user: res.body.user };
}

async function makeCustomer() {
  const res = await request(app).post('/api/auth/register').send({
    name: 'Customer',
    email: `cust-${Date.now()}-${Math.random()}@test.com`,
    password: 'Password1!',
    role: 'CUSTOMER',
  });
  return { token: res.body.token, user: res.body.user };
}

function futureDate(daysAhead = 7) {
  return new Date(Date.now() + daysAhead * 86400000).toISOString();
}

async function createEvent(token, overrides = {}) {
  return request(app)
    .post('/api/events')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Test Concert',
      venue: 'Test Arena',
      event_date: futureDate(),
      price_cents: 5000,
      total_tickets: 100,
      ...overrides,
    });
}

// ── Create event ──────────────────────────────────────────────────────────────

describe('POST /api/events', () => {
  it('organizer can create event → 201', async () => {
    const { token } = await makeOrganizer();
    const res = await createEvent(token);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.available_tickets).toBe(100);
  });

  it('event_date must be in the future → 400', async () => {
    const { token } = await makeOrganizer();
    const res = await createEvent(token, {
      event_date: new Date(Date.now() - 86400000).toISOString(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('price_cents cannot be negative → 400', async () => {
    const { token } = await makeOrganizer();
    const res = await createEvent(token, { price_cents: -1 });
    expect(res.status).toBe(400);
  });
});

// ── List events ───────────────────────────────────────────────────────────────

describe('GET /api/events', () => {
  it('returns upcoming events (public)', async () => {
    const { token } = await makeOrganizer();
    await createEvent(token);
    const res = await request(app).get('/api/events');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('supports pagination (limit/offset)', async () => {
    const { token } = await makeOrganizer();
    await createEvent(token, { title: 'A' });
    await createEvent(token, { title: 'B' });
    const res = await request(app).get('/api/events?limit=1&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.limit).toBe(1);
  });

  it('rejects limit > 100 → 400', async () => {
    const res = await request(app).get('/api/events?limit=200');
    expect(res.status).toBe(400);
  });
});

// ── Get event ─────────────────────────────────────────────────────────────────

describe('GET /api/events/:id', () => {
  it('returns event with available_tickets', async () => {
    const { token } = await makeOrganizer();
    const create = await createEvent(token);
    const eventId = create.body.id;

    const res = await request(app).get(`/api/events/${eventId}`);
    expect(res.status).toBe(200);
    expect(res.body.available_tickets).toBe(100);
  });

  it('returns 404 for unknown event', async () => {
    const res = await request(app).get('/api/events/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

// ── PATCH event ───────────────────────────────────────────────────────────────

describe('PATCH /api/events/:id', () => {
  it('owner can update title → 200', async () => {
    const { token } = await makeOrganizer();
    const create = await createEvent(token);
    const eventId = create.body.id;

    const res = await request(app)
      .patch(`/api/events/${eventId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated Title' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
    expect(res.body.version).toBe(2);
  });

  it('non-owner organizer gets 404 (not 403)', async () => {
    const { token: org1token } = await makeOrganizer();
    const { token: org2token } = await makeOrganizer();
    const create = await createEvent(org1token);
    const eventId = create.body.id;

    const res = await request(app)
      .patch(`/api/events/${eventId}`)
      .set('Authorization', `Bearer ${org2token}`)
      .send({ title: 'Hijacked' });
    expect(res.status).toBe(404); // not 403 — do not reveal existence
  });

  it('rejects total_tickets below already-sold count → 409 CAPACITY_BELOW_SOLD', async () => {
    const { token: orgToken } = await makeOrganizer();
    const { token: custToken } = await makeCustomer();

    const create = await createEvent(orgToken, { total_tickets: 10 });
    const eventId = create.body.id;

    // Book 5 tickets
    await request(app)
      .post(`/api/events/${eventId}/book`)
      .set('Authorization', `Bearer ${custToken}`)
      .set('Idempotency-Key', 'key-events-test-12345678')
      .send({ tickets_count: 5 });

    // Try to reduce to 3 (below 5 sold)
    const res = await request(app)
      .patch(`/api/events/${eventId}`)
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ total_tickets: 3 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CAPACITY_BELOW_SOLD');
  });

  it('requires at least one field → 400 VALIDATION_ERROR', async () => {
    const { token } = await makeOrganizer();
    const create = await createEvent(token);

    const res = await request(app)
      .patch(`/api/events/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── Organizer bookings list ───────────────────────────────────────────────────

describe('GET /api/events/:id/bookings', () => {
  it('owner can see bookings for their event', async () => {
    const { token: orgToken } = await makeOrganizer();
    const { token: custToken } = await makeCustomer();

    const create = await createEvent(orgToken);
    const eventId = create.body.id;

    await request(app)
      .post(`/api/events/${eventId}/book`)
      .set('Authorization', `Bearer ${custToken}`)
      .set('Idempotency-Key', 'key-bookings-list-1234567')
      .send({ tickets_count: 2 });

    const res = await request(app)
      .get(`/api/events/${eventId}/bookings`)
      .set('Authorization', `Bearer ${orgToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].tickets_count).toBe(2);
  });

  it('non-owner organizer sees empty list (SQL ownership guard)', async () => {
    const { token: org1 } = await makeOrganizer();
    const { token: org2 } = await makeOrganizer();
    const create = await createEvent(org1);
    const eventId = create.body.id;

    const res = await request(app)
      .get(`/api/events/${eventId}/bookings`)
      .set('Authorization', `Bearer ${org2}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });
});
