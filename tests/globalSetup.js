// Global test setup — runs once before all test files.
// Sets environment variables and runs migrations.
// NOTE: This file is loaded by vitest as ESM (globalSetup).
//       We set env vars here BEFORE any CJS require() of src/config.

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5433/pulsetix_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long-xxx';
process.env.JWT_EXPIRES_IN = '1h';
process.env.BCRYPT_ROUNDS = '4'; // fast for tests
process.env.ORGANIZER_SIGNUP_CODE = 'TEST_ORG_CODE';
process.env.SMTP_HOST = 'localhost';
process.env.SMTP_PORT = '1025';
process.env.SMTP_USER = 'test';
process.env.SMTP_PASS = 'test';
process.env.SMTP_FROM = 'test@example.com';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.ENABLE_NAIVE = 'false';
process.env.EMAIL_RATE_PER_SEC = '100';
process.env.OUTBOX_POLL_MS = '500';
process.env.OUTBOX_BATCH_SIZE = '100';
process.env.DB_POOL_MAX = '5';
process.env.LOG_LEVEL = 'warn';
process.env.METRICS_TOKEN = 'test-metrics-token-12345';

export async function setup() {
  const { createRequire } = await import('module');
  const { fileURLToPath } = await import('url');
  const { dirname, join } = await import('path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const require = createRequire(join(__dirname, 'package.json')); // anchor to project root
  const { migrate } = require('../src/db/migrate.js');
  await migrate();
}

export async function teardown() {
  const { createRequire } = await import('module');
  const { fileURLToPath } = await import('url');
  const { dirname, join } = await import('path');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const require = createRequire(join(__dirname, 'package.json'));
  const { closePool } = require('../src/db/pool.js');
  await closePool();
}

