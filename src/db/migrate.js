'use strict';

const fs = require('fs');
const path = require('path');
const { getPool } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Forward-only migration runner.
 * Creates a migrations tracking table, then applies any .sql files
 * in the migrations/ directory that have not yet been applied.
 * Files must be named NNN_description.sql (e.g. 001_initial.sql).
 */
async function migrate() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Ensure tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id   SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows: applied } = await client.query(
      'SELECT name FROM _migrations ORDER BY id',
    );
    const appliedSet = new Set(applied.map((r) => r.name));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO _migrations (name) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
        // eslint-disable-next-line no-console
        console.log(`[migrate] Applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed [${file}]: ${err.message}`);
      }
    }
  } finally {
    client.release();
  }
}

// Run as standalone script: node src/db/migrate.js
if (require.main === module) {
  migrate()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log('[migrate] All migrations applied.');
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[migrate] ERROR:', err.message);
      process.exit(1);
    });
}

module.exports = { migrate };
