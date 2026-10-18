'use strict';

/**
 * Smoke test: sends a real email to verify SMTP credentials.
 * Run: node scripts/mail-test.js
 */

// Load env before importing config
require('dotenv').config();

const { createTransport } = require('../src/mail/transport');
const config = require('../src/config');

async function main() {
  // eslint-disable-next-line no-console
  console.log(`[mail-test] Sending test email via ${config.SMTP_HOST}:${config.SMTP_PORT}...`);

  const transport = createTransport();
  const info = await transport.sendMail({
    from: config.SMTP_FROM,
    to: config.SMTP_FROM, // send to self for smoke test
    subject: 'PulseTix — SMTP smoke test',
    text: [
      'If you can read this, SMTP is working correctly.',
      '',
      `Host : ${config.SMTP_HOST}`,
      `Port : ${config.SMTP_PORT}`,
      `From : ${config.SMTP_FROM}`,
      `Time : ${new Date().toISOString()}`,
    ].join('\n'),
  });

  // eslint-disable-next-line no-console
  console.log('[mail-test] ✅ Email sent! messageId:', info.messageId);
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[mail-test] ❌ Failed:', err.message);
  process.exit(1);
});
