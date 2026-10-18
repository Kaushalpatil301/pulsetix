'use strict';

/**
 * V1 NAIVE BOOKING — for baseline benchmark only.
 *
 * WARNING: This implementation is INTENTIONALLY BROKEN under concurrency:
 *  - Read-then-write (race condition → oversold tickets)
 *  - Inline SMTP (blocks the HTTP response until email is sent)
 *  - No idempotency
 *
 * Only reachable when ENABLE_NAIVE=true in env.
 * NEVER enable in production.
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/authenticate');
const { requireRole } = require('../middleware/requireRole');
const { AppError } = require('../errors');
const { query } = require('../db/pool');
const { createTransport } = require('../mail/transport');
const { bookingConfirmationHtml, bookingConfirmationText } = require('../mail/templates/bookingConfirmation');

const router = Router();

router.post(
  '/:id/book-naive',
  authenticate,
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const eventId = req.params.id;
    const customerId = req.user.id;
    const ticketsCount = parseInt(req.body.tickets_count, 10);

    if (!ticketsCount || ticketsCount < 1 || ticketsCount > 10) {
      throw new AppError(400, 'VALIDATION_ERROR', 'tickets_count must be 1–10');
    }

    // ── NAIVE: Read current inventory ─────────────────────────────────────
    // RACE CONDITION: another request can read the same value and both succeed
    const { rows: eventRows } = await query(
      'SELECT id, title, venue, event_date, price_cents, available_tickets FROM events WHERE id = $1 AND event_date > NOW()',
      [eventId],
    );

    if (eventRows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Event not found or has started');
    }

    const event = eventRows[0];

    if (event.available_tickets < ticketsCount) {
      throw new AppError(409, 'SOLD_OUT', 'Not enough tickets available', {
        available: event.available_tickets,
      });
    }

    // ── NAIVE: Inline SMTP — blocks HTTP response ─────────────────────────
    // This is what makes V1 slow: the caller waits for the SMTP round trip
    const { rows: userRows } = await query(
      'SELECT name, email FROM users WHERE id = $1',
      [customerId],
    );
    const customer = userRows[0];

    // ── NAIVE: Separate UPDATE + INSERT (not atomic) ───────────────────────
    await query(
      'UPDATE events SET available_tickets = available_tickets - $1 WHERE id = $2',
      [ticketsCount, eventId],
    );

    const totalCents = event.price_cents * ticketsCount;
    const { rows: bookingRows } = await query(
      `INSERT INTO bookings
         (event_id, customer_id, tickets_count, total_cents, idempotency_key, request_hash, status)
       VALUES ($1, $2, $3, $4, gen_random_uuid()::text, 'naive', 'CONFIRMED')
       RETURNING id, event_id, customer_id, tickets_count, total_cents, status, created_at`,
      [eventId, customerId, ticketsCount, totalCents],
    );

    const booking = bookingRows[0];

    // ── NAIVE: Send email inline (blocks!) ────────────────────────────────
    try {
      const transport = createTransport();
      await transport.sendMail({
        from: require('../config').SMTP_FROM,
        to: customer.email,
        subject: `[V1-NAIVE] Booking Confirmed — ${event.title}`,
        text: bookingConfirmationText({ booking, event, customer }),
        html: bookingConfirmationHtml({ booking, event, customer }),
      });
    } catch (_emailErr) {
      // In V1, email failure is swallowed — another weakness
      req.log && req.log.warn('V1 naive: email send failed');
    }

    res.status(201).json(booking);
  }),
);

module.exports = router;
