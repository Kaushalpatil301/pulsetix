'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { AppError } = require('../errors');

/**
 * Verifies the Bearer JWT and attaches { id, role } to req.user.
 * Does NOT hit the database — roles are embedded in the token.
 */
function authenticate(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return next(
      new AppError(401, 'UNAUTHENTICATED', 'Authorization header missing or malformed'),
    );
  }

  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (_err) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired token'));
  }
}

module.exports = { authenticate };
