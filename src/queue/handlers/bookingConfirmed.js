'use strict';

/**
 * BullMQ job handler: booking_confirmed
 *
 * Payload: { booking_id, customer_id, event_id }
 *
 * Steps:
 *  1. Check notification_log for dedupe_key — skip if already sent (idempotent retry)
 *  2. Load booking, customer, event from DB
 *  3. Send real email via Nodemailer + SMTP
 *  4. Write notification_log row
 *
 * This handler is the ONLY place that sends booking confirmation emails.
 * Never called from HTTP routes.
 */

const { query } = require('../../db/pool');
const { createTransport } = require('../../mail/transport');
const { bookingConfirmationText, bookingConfirmationHtml } = require('../../mail/templates/bookingConfirmation');
const config = require('../../config');

async function handleBookingConfirmed(job) {
  const { booking_id, customer_id, event_id } = job.data;
  const dedupeKey = `booking:${booking_id}`;

  // ── Dedupe check ─────────────────────────────────────────────────────────
  const { rows: already } = await query(
    'SELECT dedupe_key FROM notification_log WHERE dedupe_key = $1',
    [dedupeKey],
  );
  if (already.length > 0) {
    job.log(`Skipped (already sent): ${dedupeKey}`);
    return { skipped: true };
  }

  // ── Load data ────────────────────────────────────────────────────────────
  const { rows: bookingRows } = await query(
    `SELECT b.id, b.tickets_count, b.total_cents, b.status, b.created_at,
            u.name, u.email,
            e.title, e.venue, e.event_date, e.price_cents
     FROM bookings b
     JOIN users u ON u.id = b.customer_id
     JOIN events e ON e.id = b.event_id
     WHERE b.id = $1 AND b.customer_id = $2 AND b.event_id = $3`,
    [booking_id, customer_id, event_id],
  );

  if (bookingRows.length === 0) {
    // Booking deleted or IDs mismatch — skip gracefully
    job.log(`Booking not found: ${booking_id}`);
    return { skipped: true };
  }

  const row = bookingRows[0];
  const customer = { name: row.name, email: row.email };
  const event = {
    title: row.title,
    venue: row.venue,
    event_date: row.event_date,
    price_cents: row.price_cents,
  };
  const booking = {
    id: row.id,
    tickets_count: row.tickets_count,
    total_cents: row.total_cents,
    status: row.status,
    created_at: row.created_at,
  };

  // ── Send email ───────────────────────────────────────────────────────────
  const transport = createTransport();
  await transport.sendMail({
    from: config.SMTP_FROM,
    to: customer.email,
    subject: `Booking Confirmed — ${event.title}`,
    text: bookingConfirmationText({ booking, event, customer }),
    html: bookingConfirmationHtml({ booking, event, customer }),
  });

  // ── Record send (dedupe) ─────────────────────────────────────────────────
  await query(
    `INSERT INTO notification_log (dedupe_key, kind, recipient)
     VALUES ($1, 'booking_confirmed', $2)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [dedupeKey, customer.email],
  );

  job.log(`Email sent to ${customer.email} for booking ${booking_id}`);
  return { sent: true, to: customer.email };
}

module.exports = { handleBookingConfirmed };
