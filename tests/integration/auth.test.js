import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';

const app = buildApp();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function registerCustomer(overrides = {}) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      name: 'Test Customer',
      email: `customer-${Date.now()}@example.com`,
      password: 'Password1!',
      role: 'CUSTOMER',
      ...overrides,
    });
  return res;
}

async function registerOrganizer(overrides = {}) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      name: 'Test Organizer',
      email: `organizer-${Date.now()}@example.com`,
      password: 'Password1!',
      role: 'ORGANIZER',
      organizer_code: 'TEST_ORG_CODE',
      ...overrides,
    });
  return res;
}

// ── Registration ─────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  it('registers a CUSTOMER and returns 201 with token', async () => {
    const res = await registerCustomer();
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('CUSTOMER');
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('registers an ORGANIZER with correct signup code', async () => {
    const res = await registerOrganizer();
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('ORGANIZER');
  });

  it('rejects ORGANIZER with wrong signup code → 403 FORBIDDEN', async () => {
    const res = await registerOrganizer({ organizer_code: 'WRONG_CODE' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects ORGANIZER with no signup code → 403 FORBIDDEN', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Bad Organizer',
      email: `org-bad-${Date.now()}@example.com`,
      password: 'Password1!',
      role: 'ORGANIZER',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects duplicate email → 409 EMAIL_TAKEN', async () => {
    const email = `dup-${Date.now()}@example.com`;
    await registerCustomer({ email });
    const res = await registerCustomer({ email });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects short password → 400 VALIDATION_ERROR', async () => {
    const res = await registerCustomer({ password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid email → 400 VALIDATION_ERROR', async () => {
    const res = await registerCustomer({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials → 200 with token', async () => {
    const email = `login-${Date.now()}@example.com`;
    await registerCustomer({ email });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'Password1!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('rejects wrong password → 401 UNAUTHENTICATED', async () => {
    const email = `login-wp-${Date.now()}@example.com`;
    await registerCustomer({ email });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'WrongPassword!' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects unknown email → 401 UNAUTHENTICATED', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'Password1!' });
    expect(res.status).toBe(401);
  });
});

// ── RBAC matrix ──────────────────────────────────────────────────────────────

describe('RBAC: customer cannot access organizer-only routes', () => {
  it('POST /api/events with CUSTOMER token → 403 FORBIDDEN', async () => {
    const reg = await registerCustomer();
    const token = reg.body.token;
    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Test Event',
        venue: 'Venue',
        event_date: new Date(Date.now() + 86400000).toISOString(),
        price_cents: 1000,
        total_tickets: 100,
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('PATCH /api/events/:id with CUSTOMER token → 403 FORBIDDEN', async () => {
    const reg = await registerCustomer();
    const token = reg.body.token;
    const res = await request(app)
      .patch('/api/events/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated' });
    expect(res.status).toBe(403);
  });

  it('GET /api/events/:id/bookings with CUSTOMER token → 403 FORBIDDEN', async () => {
    const reg = await registerCustomer();
    const token = reg.body.token;
    const res = await request(app)
      .get('/api/events/00000000-0000-0000-0000-000000000000/bookings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('RBAC: organizer cannot book', () => {
  it('POST /api/events/:id/book with ORGANIZER token → 403 FORBIDDEN', async () => {
    const reg = await registerOrganizer();
    const token = reg.body.token;
    const res = await request(app)
      .post('/api/events/00000000-0000-0000-0000-000000000000/book')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'test-key-12345678')
      .send({ tickets_count: 1 });
    expect(res.status).toBe(403);
  });
});

describe('Unauthenticated access to protected routes → 401', () => {
  it('POST /api/events without token → 401', async () => {
    const res = await request(app).post('/api/events').send({});
    expect(res.status).toBe(401);
  });

  it('GET /api/bookings/me without token → 401', async () => {
    const res = await request(app).get('/api/bookings/me');
    expect(res.status).toBe(401);
  });
});
