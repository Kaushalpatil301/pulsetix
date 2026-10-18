'use strict';

const { AppError } = require('../errors');

/**
 * Factory: returns middleware that allows only the specified roles.
 * Must run AFTER authenticate (requires req.user).
 *
 * @param {...string} roles - e.g. requireRole('ORGANIZER') or requireRole('CUSTOMER', 'ORGANIZER')
 */
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'Not authenticated'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', 'Insufficient role'));
    }
    next();
  };
}

module.exports = { requireRole };
