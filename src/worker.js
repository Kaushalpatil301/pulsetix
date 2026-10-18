'use strict';

/**
 * Worker process entry point.
 *
 * Responsibilities:
 *  1. BullMQ worker — processes notification jobs
 *  2. Outbox dispatcher — polls DB and enqueues new outbox rows to BullMQ
 *
 * Separate process from the API server (see architecture.md).
 * HTTP handlers NEVER import this file.
 */

const pino = require('pino');
const { Worker } = require('bullmq');
const config = require('./config');
const { connection } = require('./queue');
const { handleBookingConfirmed } = require('./queue/handlers/bookingConfirmed');
const { handleEventUpdated, handleEventUpdatedRecipient } = require('./queue/handlers/eventUpdated');
const { startDispatcher, stopDispatcher } = require('./outbox/dispatcher');
const { migrate } = require('./db/migrate');
const { closePool } = require('./db/pool');

const logger = pino({ level: config.LOG_LEVEL });

// Rate-limit helpers (simple token bucket)
let emailTokens = config.EMAIL_RATE_PER_SEC;
setInterval(() => {
  emailTokens = config.EMAIL_RATE_PER_SEC;
}, 1000);

async function rateLimitedHandler(fn, job) {
  if (emailTokens <= 0) {
    // Delay — BullMQ will retry via backoff anyway, but let's be cooperative
    await new Promise((r) => setTimeout(r, 200));
  }
  emailTokens = Math.max(0, emailTokens - 1);
  return fn(job);
}

async function processJob(job) {
  logger.info({ jobId: job.id, jobName: job.name }, 'worker: processing job');
  try {
    switch (job.name) {
      case 'booking_confirmed':
        return await rateLimitedHandler(handleBookingConfirmed, job);
      case 'event_updated':
        return await handleEventUpdated(job);
      case 'event_updated_recipient':
        return await rateLimitedHandler(handleEventUpdatedRecipient, job);
      default:
        logger.warn({ jobName: job.name }, 'worker: unknown job type');
        return { skipped: true };
    }
  } catch (err) {
    logger.error({ jobId: job.id, jobName: job.name, err: err.message }, 'worker: job failed');
    throw err; // BullMQ will handle retry with backoff
  }
}

async function main() {
  // Ensure schema is up to date
  await migrate();

  const worker = new Worker('notifications', processJob, {
    connection,
    concurrency: 10,
    limiter: {
      max: config.EMAIL_RATE_PER_SEC,
      duration: 1000,
    },
  });

  worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, result }, 'worker: job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'worker: job failed permanently');
  });

  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'worker: error');
  });

  startDispatcher(logger);

  logger.info('Worker process started');

  // ── Graceful shutdown ────────────────────────────────────────────────────
  async function shutdown(signal) {
    logger.info({ signal }, 'Worker shutting down...');
    stopDispatcher();
    await worker.close();
    await closePool();
    logger.info('Worker closed. Goodbye.');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Worker: unhandled rejection');
  });
}

main().catch((err) => {
  logger.error({ err: err.message }, 'Worker fatal startup error');
  process.exit(1);
});
