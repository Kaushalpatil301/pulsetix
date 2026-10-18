'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');

const https = require('https');

let _transport = null;

function sendViaBrevoApi(mailOptions) {
  return new Promise((resolve, reject) => {
    let senderName = 'PulseTix';
    let senderEmail = mailOptions.from || config.SMTP_FROM;
    const match = senderEmail.match(/^(?:(.*?)<)?([^<>]+)>?$/);
    if (match) {
      if (match[1] && match[1].trim()) senderName = match[1].trim();
      senderEmail = match[2].trim();
    }

    const payload = JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: mailOptions.to }],
      subject: mailOptions.subject,
      ...(mailOptions.text ? { textContent: mailOptions.text } : {}),
      ...(mailOptions.html ? { htmlContent: mailOptions.html } : {}),
    });

    const req = https.request(
      {
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        headers: {
          'api-key': config.SMTP_PASS,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(body);
              resolve({ messageId: parsed.messageId });
            } catch {
              resolve({ messageId: `brevo-${Date.now()}` });
            }
          } else {
            reject(new Error(`Brevo API error (${res.statusCode}): ${body}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Returns a singleton Nodemailer transport or Brevo API adapter.
 * In test mode, returns a json transport that captures messages without sending.
 * IMPORTANT: Only import this from src/queue/ handlers, never from HTTP routes.
 */
function createTransport() {
  if (_transport) return _transport;

  if (config.NODE_ENV === 'test') {
    _transport = nodemailer.createTransport({ jsonTransport: true });
    return _transport;
  }

  // If using Brevo API key (starts with xkeysib-), use HTTPS REST API directly
  // This bypasses cloud port 587/465 blocks and ensures 100% reliable delivery
  if (config.SMTP_PASS && config.SMTP_PASS.startsWith('xkeysib-')) {
    _transport = {
      sendMail: (options) => sendViaBrevoApi(options),
    };
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
