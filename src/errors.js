'use strict';

/**
 * Domain error — the only error type that errorHandler turns into HTTP responses.
 * @property {number} status  - HTTP status code
 * @property {string} code    - Machine-readable error code (see api-contract.md)
 * @property {object} details - Optional structured detail (e.g. field errors)
 */
class AppError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

module.exports = { AppError };
