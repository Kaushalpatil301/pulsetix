'use strict';

const { Pool } = require('pg');
const config = require('../config');

let pool;

/**
 * Returns the singleton pg Pool.
 * Pool is created lazily so tests can override DATABASE_URL before first use.
 */
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DB_POOL_MAX,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      // Log but do not crash — pool handles reconnection
      // eslint-disable-next-line no-console
      console.error('[db/pool] Unexpected error on idle client', err.message);
    });
  }
  return pool;
}

/**
 * Closes the pool. Call on graceful shutdown.
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Convenience: run a single query on a pool client.
 * @param {string} text
 * @param {any[]} [params]
 */
async function query(text, params) {
  return getPool().query(text, params);
}

/**
 * Borrow a client for multi-statement transactions.
 * Caller must call client.release() in a finally block.
 */
async function connect() {
  return getPool().connect();
}

module.exports = { getPool, closePool, query, connect };
