'use strict';

const { AppError } = require('../errors');

/**
 * Factory: validates req.body (or req.query, req.params) against a zod schema.
 * Attaches the parsed+stripped data back to the same location.
 *
 * @param {import('zod').ZodSchema} schema
 * @param {'body'|'query'|'params'|'headers'} [source='body']
 */
function validate(schema, source = 'body') {
  return function (req, _res, next) {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.flatten().fieldErrors;
      return next(
        new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details),
      );
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };
