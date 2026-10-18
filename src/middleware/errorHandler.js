'use strict';

const { AppError } = require('../errors');

/**
 * Global error handler (must have 4 args so Express recognises it).
 * Turns AppError instances into structured JSON responses.
 * Unexpected errors are logged and returned as 500 INTERNAL — never leaking internals.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    return res.status(err.status).json(body);
  }

  // Unexpected error — log with pino via req.log (attached by pino-http)
  if (req.log) {
    req.log.error({ err, request_id: req.id }, 'Unhandled error');
  }

  res.status(500).json({
    error: { code: 'INTERNAL', message: 'An unexpected error occurred' },
  });
}

/**
 * Wraps an async route handler so rejections are forwarded to next().
 * @param {Function} fn - async (req, res, next) => void
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { errorHandler, asyncHandler };
