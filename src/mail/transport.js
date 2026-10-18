'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');

let _transport = null;

/**
 * Returns a singleton Nodemailer transport.
 * In test mode, returns a json transport that captures messages without sending.
 * IMPORTANT: Only import this from src/queue/ handlers, never from HTTP routes.
 */
function createTransport() {
  if (_transport) return _transport;

  if (config.NODE_ENV === 'test') {
    _transport = nodemailer.createTransport({ jsonTransport: true });
    return _transport;
  }

  _transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
  });

  return _transport;
}

/** Reset transport (test teardown) */
function resetTransport() {
  _transport = null;
}

module.exports = { createTransport, resetTransport };
