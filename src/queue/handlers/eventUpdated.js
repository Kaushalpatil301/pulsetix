'use strict';

/**
 * BullMQ job handlers for event_updated outbox events.
 *
 * Two-stage fan-out:
 *
 * Stage 1 — handleEventUpdated (job type: 'event_updated')
 *   Payload: { event_id, version, changed_fields }
 *   Action:  Pages through all confirmed bookings for the event in batches of 100.
 *            For each customer, enqueues a per-recipient job (type: 'event_updated_recipient')
 *            with a deterministic jobId = eu:{event_id}:{version}:{customer_id}.
 *
 * Stage 2 — handleEventUpdatedRecipient (job type: 'event_updated_recipient')
 *   Payload: { event_id, version, customer_id, changed_fields }
 *   Action:  Sends the update email to one customer. Idempotent via notification_log.
 *
 * This pattern gives isolated retries and prevents duplicate sends even under failures.
 */

const { query } = require('../../db/pool');
const { notificationQueue } = require('../index');
const { createTransport } = require('../../mail/transport');
const { eventUpdateText, eventUpdateHtml } = require('../../mail/templates/eventUpdate');
const config = require('../../config');

const BATCH_SIZE = 100;

// ── Stage 1: fan-out dispatcher ──────────────────────────────────────────────

async function handleEventUpdated(job) {
  const { event_id, version, changed_fields } = job.data;

  // Load current event state
  const { rows: eventRows } = await query(
    `SELECT id, title, venue, event_date, price_cents, description FROM events WHERE id = $1`,
    [event_id],
  );
  if (eventRows.length === 0) {
    job.log(`Event not found: ${event_id}`);
    return { skipped: true };
  }

  // Page through confirmed bookings in batches
  let offset = 0;
  let total = 0;

  while (true) {
    const { rows: customers } = await query(
      `SELECT DISTINCT b.customer_id
       FROM bookings b
       WHERE b.event_id = $1 AND b.status = 'CONFIRMED'
       ORDER BY b.customer_id
       LIMIT $2 OFFSET $3`,
      [event_id, BATCH_SIZE, offset],
    );

    if (customers.length === 0) break;

    // Enqueue per-recipient jobs with deterministic jobId
    const jobs = customers.map((c) => ({
      name: 'event_updated_recipient',
      data: {
        event_id,
        version,
        customer_id: c.customer_id,
        changed_fields,
      },
      opts: {
        jobId: `eu:${event_id}:${version}:${c.customer_id}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      },
    }));

    await notificationQueue.addBulk(jobs);
    total += customers.length;
    offset += BATCH_SIZE;

    if (customers.length < BATCH_SIZE) break;
  }

  job.log(`Enqueued ${total} recipient jobs for event ${event_id} v${version}`);
  return { enqueued: total };
}

// ── Stage 2: per-recipient email ─────────────────────────────────────────────

async function handleEventUpdatedRecipient(job) {
  const { event_id, version, customer_id, changed_fields } = job.data;
  const dedupeKey = `event_update:${event_id}:${version}:${customer_id}`;

  // Dedupe check
  const { rows: already } = await query(
    'SELECT dedupe_key FROM notification_log WHERE dedupe_key = $1',
    [dedupeKey],
  );
  if (already.length > 0) {
    job.log(`Skipped (already sent): ${dedupeKey}`);
    return { skipped: true };
  }

  // Load event + customer
  const { rows } = await query(
    `SELECT e.id, e.title, e.venue, e.event_date, e.price_cents, e.description,
            u.name, u.email
     FROM events e, users u
     WHERE e.id = $1 AND u.id = $2`,
    [event_id, customer_id],
  );

  if (rows.length === 0) {
    job.log(`Event or customer not found: ${event_id} / ${customer_id}`);
    return { skipped: true };
  }

  const row = rows[0];
  const event = {
    id: row.id,
    title: row.title,
    venue: row.venue,
    event_date: row.event_date,
    price_cents: row.price_cents,
    description: row.description,
  };
  const customer = { name: row.name, email: row.email };

  // Send email
  const transport = createTransport();
  await transport.sendMail({
    from: config.SMTP_FROM,
    to: customer.email,
    subject: `Event Updated — ${event.title}`,
    text: eventUpdateText({ event, changedFields: changed_fields, before: null, customer }),
    html: eventUpdateHtml({ event, changedFields: changed_fields, before: null, customer }),
  });

  // Record send
  await query(
    `INSERT INTO notification_log (dedupe_key, kind, recipient)
     VALUES ($1, 'event_updated', $2)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [dedupeKey, customer.email],
  );

  job.log(`Email sent to ${customer.email} for event update ${event_id} v${version}`);
  return { sent: true, to: customer.email };
}

module.exports = { handleEventUpdated, handleEventUpdatedRecipient };
