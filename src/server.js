'use strict';

const { buildApp, logger } = require('./app');
const { migrate } = require('./db/migrate');
const { closePool } = require('./db/pool');
const config = require('./config');
const { startWorker, stopWorker } = require('./worker');

async function main() {
  // Run migrations on startup
  logger.info('Running migrations...');
  await migrate();
  logger.info('Migrations complete.');

  // If running in single-service mode (e.g. Render free tier), start the worker alongside API
  if (process.env.RUN_EMBEDDED_WORKER === 'true') {
    logger.info('Starting embedded background worker & outbox dispatcher...');
    await startWorker(logger);
  }

  const app = buildApp();

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API server started');
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down...');

    if (process.env.RUN_EMBEDDED_WORKER === 'true') {
      await stopWorker();
    }

    server.close(async () => {
      await closePool();
      logger.info('Server closed. Goodbye.');
      process.exit(0);
    });

    // Force exit after 10 s
    setTimeout(() => {
      logger.error('Forced exit after timeout');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
}

main().catch((err) => {
  logger.error({ err: err.message }, 'Fatal startup error');
  process.exit(1);
});
