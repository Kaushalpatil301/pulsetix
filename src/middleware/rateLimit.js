'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

function makeRateLimiter(options) {
  if (!config.RATE_LIMIT_ENABLED) {
    return (_req, _res, next) => next();
  }
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' },
      });
    },
    ...options,
  });
}

/** 20 req / min / IP on all auth routes */
const authLimiter = makeRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
});

/** Per-user booking limit (configurable) */
const bookingLimiter = makeRateLimiter({
  windowMs: 60 * 1000,
  max: config.BOOKING_RATE_LIMIT_PER_MIN,
  keyGenerator: (req) => req.user?.id || req.ip,
});

module.exports = { authLimiter, bookingLimiter };
