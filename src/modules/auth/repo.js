'use strict';

const { query } = require('../../db/pool');

/**
 * @param {string} email
 * @returns {Promise<object|null>}
 */
async function findByEmail(email) {
  const { rows } = await query(
    'SELECT id, name, email, password_hash, role, created_at FROM users WHERE email = $1',
    [email],
  );
  return rows[0] || null;
}

/**
 * @param {{ name: string, email: string, passwordHash: string, role: string }} data
 * @returns {Promise<object>}
 */
async function createUser({ name, email, passwordHash, role }) {
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, role, created_at`,
    [name, email, passwordHash, role],
  );
  return rows[0];
}

module.exports = { findByEmail, createUser };
