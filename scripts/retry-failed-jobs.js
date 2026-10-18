'use strict';

/**
 * Re-drives permanently failed BullMQ jobs back into the active queue.
 * Run: node scripts/retry-failed-jobs.js
 *
 * Useful when SMTP was down and jobs moved to the failed set.
 * BullMQ keeps failed jobs in the 'failed' set (configurable removeOnFail).
 */

require('dotenv').config();

const { Queue } = require('bullmq');
const config = require('../src/config');

function parseRedisUrl(url) {
  const u = new URL(url);
  const opts = {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 6379,
    maxRetriesPerRequest: null,
  };
  if (u.password) opts.password = decodeURIComponent(u.password);
  if (u.protocol === 'rediss:') opts.tls = {};
  return opts;
}

async function main() {
  const connection = parseRedisUrl(config.REDIS_URL);
  const queue = new Queue('notifications', { connection });

  const failed = await queue.getFailed();
  // eslint-disable-next-line no-console
  console.log(`[retry] Found ${failed.length} failed jobs`);

  let retried = 0;
  for (const job of failed) {
    try {
      await job.retry();
      retried++;
      // eslint-disable-next-line no-console
      console.log(`[retry] Re-queued job ${job.id} (${job.name})`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[retry] Failed to re-queue job ${job.id}:`, err.message);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[retry] Done. Retried ${retried}/${failed.length} jobs.`);
  await queue.close();
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[retry] Error:', err.message);
  process.exit(1);
});
