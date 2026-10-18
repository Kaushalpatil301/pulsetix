import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';

const app = buildApp();

describe('GET /api/health', () => {
  it('returns ok:true with 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('echoes X-Request-Id header', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('X-Request-Id', 'my-trace-id-123');
    expect(res.headers['x-request-id']).toBe('my-trace-id-123');
  });

  it('generates X-Request-Id when not provided', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(typeof res.headers['x-request-id']).toBe('string');
  });

  it('unknown routes return 404 NOT_FOUND', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
