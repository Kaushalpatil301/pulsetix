'use strict';

/**
 * Transactional outbox dispatcher.
 *
 * Polls outbox_events WHERE processed_at IS NULL using FOR UPDATE SKIP LOCKED
 * (safe for multiple dispatcher instances).
 *
 * For each pending row, enqueues a BullMQ job with jobId = outbox row id.
 * BullMQ deduplicates by jobId, so crashing between enqueue and mark-processed
 * is safe — the dispatcher will retry, but BullMQ won't add a second job.
 *
 * Only called from src/worker.js. Never from HTTP handlers.
 */

const { connect } = require('../db/pool');
const { notificationQueue } = require('../queue');
const config = require('../config');

const JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1000 },
};

let timer = null;

async function runOnce(logger) {
  const client = await connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, event_type, payload
       FROM outbox_events
       WHERE processed_at IS NULL
       ORDER BY id
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [config.OUTBOX_BATCH_SIZE],
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return;
    }

    const ids = [];
    for (const row of rows) {
      const jobId = `outbox:${row.id}`;
      await notificationQueue.add(row.event_type, row.payload, {
        ...JOB_OPTS,
        jobId,
      });
      ids.push(row.id);
    }

    await client.query(
      `UPDATE outbox_events SET processed_at = NOW() WHERE id = ANY($1::bigint[])`,
      [ids],
    );

    await client.query('COMMIT');
    logger.info({ count: ids.length }, 'outbox: dispatched jobs');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: err.message }, 'outbox: dispatch error');
  } finally {
    client.release();
  }
}

function startDispatcher(logger) {
  const poll = async () => {
    try {
      await runOnce(logger);
    } catch (err) {
      logger.error({ err: err.message }, 'outbox: unexpected error');
    } finally {
      timer = setTimeout(poll, config.OUTBOX_POLL_MS);
    }
  };

  timer = setTimeout(poll, 0); // start immediately
  logger.info({ pollMs: config.OUTBOX_POLL_MS }, 'outbox dispatcher started');
}

function stopDispatcher() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

module.exports = { startDispatcher, stopDispatcher };
