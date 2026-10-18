'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Attaches a request-scoped ID.
 * Echoes X-Request-Id from the client if provided; otherwise generates one.
 */
function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || uuidv4();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = { requestId };
