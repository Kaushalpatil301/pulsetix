'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const { AppError } = require('../../errors');
const repo = require('./repo');

/**
 * @param {{ name, email, password, role, organizer_code }} data
 * @returns {Promise<{ user: object, token: string }>}
 */
async function register({ name, email, password, role, organizer_code }) {
  // Gate organizer registration behind an env signup code
  if (role === 'ORGANIZER') {
    if (!organizer_code || organizer_code !== config.ORGANIZER_SIGNUP_CODE) {
      throw new AppError(403, 'FORBIDDEN', 'Invalid or missing organizer signup code');
    }
  }

  const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

  let user;
  try {
    user = await repo.createUser({ name, email, passwordHash, role });
  } catch (err) {
    if (err.code === '23505') {
      // unique_violation on email
      throw new AppError(409, 'EMAIL_TAKEN', 'Email is already registered');
    }
    throw err;
  }

  const token = issueToken(user);
  return { user, token };
}

/**
 * @param {{ email, password }} data
 * @returns {Promise<{ user: object, token: string }>}
 */
async function login({ email, password }) {
  const user = await repo.findByEmail(email);
  if (!user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid credentials');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid credentials');
  }

  // Don't return the hash
  const { password_hash: _ph, ...safeUser } = user;
  const token = issueToken(safeUser);
  return { user: safeUser, token };
}

/**
 * @param {{ id: string, role: string }} user
 * @returns {string}
 */
function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  });
}

module.exports = { register, login };
