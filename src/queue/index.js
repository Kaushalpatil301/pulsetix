'use strict';

const { Queue } = require('bullmq');
const config = require('../config');

/**
 * Parse a Redis URL into ioredis connection options.
 * BullMQ uses ioredis internally.
 */
function parseRedisUrl(url) {
  const u = new URL(url);
  const opts = {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 6379,
    maxRetriesPerRequest: null, // required by BullMQ
  };
  if (u.password) opts.password = decodeURIComponent(u.password);
  if (u.protocol === 'rediss:') opts.tls = {};
  return opts;
}

const connection = parseRedisUrl(config.REDIS_URL);

const notificationQueue = new Queue('notifications', { connection });

/**
 * Expose the raw connection options so the worker can create a matching Worker instance.
 */
module.exports = { notificationQueue, connection };
