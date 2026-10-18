// Per-file setup — cleans tables before each test.
import { beforeEach, afterAll } from 'vitest';
import { query, closePool } from '../src/db/pool.js';

beforeEach(async () => {
  // Truncate data tables in dependency order (leave schema tables intact)
  await query(
    'TRUNCATE notification_log, outbox_events, bookings, events, users RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await closePool();
});
