'use strict';

const express = require('express');
const pinoHttp = require('pino-http');
const pino = require('pino');

const config = require('./config');
const { requestId } = require('./middleware/requestId');
const { errorHandler } = require('./middleware/errorHandler');
const { asyncHandler } = require('./middleware/errorHandler');
const { query, getPool } = require('./db/pool');

// Route modules
const authRoutes = require('./modules/auth/routes');
const eventRoutes = require('./modules/events/routes');
const { bookRouter, meRouter } = require('./modules/bookings/routes');

const logger = pino({ level: config.LOG_LEVEL });

/**
 * Builds and returns the Express app without calling listen().
 * Exported so tests can import and wrap with supertest.
 */
function buildApp() {
  const app = express();

  // ── Core middleware ────────────────────────────────────────────────────────
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      customLogLevel: (_req, res) => (res.statusCode >= 500 ? 'error' : 'info'),
    }),
  );
  app.use(express.json({ limit: '64kb' }));

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get('/api/health', asyncHandler(async (_req, res) => {
    await query('SELECT 1');
    res.json({ ok: true, env: config.NODE_ENV });
  }));

  // ── Metrics (protected by x-metrics-token) ────────────────────────────────
  app.get('/api/metrics', asyncHandler(async (req, res) => {
    const token = req.headers['x-metrics-token'];
    if (config.METRICS_TOKEN && token !== config.METRICS_TOKEN) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid metrics token' } });
    }

    const pool = getPool();
    const poolStats = {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };

    // Outbox backlog
    const { rows } = await query(
      'SELECT COUNT(*)::int AS backlog FROM outbox_events WHERE processed_at IS NULL',
    );

    res.json({
      pool: poolStats,
      outbox_backlog: rows[0].backlog,
      uptime_s: Math.floor(process.uptime()),
    });
  }));

  // ── API routes ─────────────────────────────────────────────────────────────
  app.use('/api/auth', authRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/events', bookRouter);   // POST /api/events/:id/book
  app.use('/api/bookings', meRouter);   // GET  /api/bookings/me

  // ── V1 naive endpoint (only when ENABLE_NAIVE=true) ───────────────────────
  if (config.ENABLE_NAIVE) {
    const naiveRoutes = require('./naive/routes');
    app.use('/api/events', naiveRoutes);
    logger.warn('ENABLE_NAIVE=true — naive booking endpoint is active. Do NOT use in production.');
  }

  // ── 404 ────────────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  // ── Error handler (must be last, must have 4 args) ────────────────────────
  app.use(errorHandler);

  return app;
}

module.exports = { buildApp, logger };
