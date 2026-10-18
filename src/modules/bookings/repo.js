'use strict';

const { query } = require('../../db/pool');

/**
 * Fast-path idempotency check.
 * Returns the existing booking if (customerId, idempotencyKey) already exists.
 * @returns {Promise<object|null>}
 */
async function findExistingBooking(customerId, idempotencyKey) {
  const { rows } = await query(
    `SELECT id, event_id, customer_id, tickets_count, total_cents,
            idempotency_key, request_hash, status, created_at
     FROM bookings
     WHERE customer_id = $1 AND idempotency_key = $2`,
    [customerId, idempotencyKey],
  );
  return rows[0] || null;
}

/**
 * The V2 atomic booking — one CTE statement:
 *   1. UPDATE events SET available_tickets = available_tickets - n
 *      WHERE id = eventId AND available_tickets >= n AND event_date > NOW()
 *   2. INSERT INTO bookings ... SELECT FROM upd
 *   3. INSERT INTO outbox_events ... SELECT FROM ins
 *
 * Returns the new booking row, or null if the UPDATE matched 0 rows
 * (sold out, event started, or event not found).
 *
 * Throws pg error 23505 if the (customer_id, idempotency_key) unique constraint fires —
 * meaning a concurrent twin already won; caller re-reads and returns 200.
 *
 * @param {{ eventId, customerId, ticketsCount, idempotencyKey, requestHash }} p
 * @returns {Promise<object|null>}
 */
async function atomicBook({ eventId, customerId, ticketsCount, idempotencyKey, requestHash }) {
  const sql = `
    WITH upd AS (
      UPDATE events
      SET available_tickets = available_tickets - $3
      WHERE id = $1
        AND available_tickets >= $3
        AND event_date > NOW()
      RETURNING id, title, venue, event_date, price_cents
    ),
    ins AS (
      INSERT INTO bookings
        (event_id, customer_id, tickets_count, total_cents, idempotency_key, request_hash, status)
      SELECT
        upd.id,
        $2,
        $3,
        upd.price_cents * $3,
        $4,
        $5,
        'CONFIRMED'
      FROM upd
      RETURNING id, event_id, customer_id, tickets_count, total_cents,
                idempotency_key, status, created_at
    ),
    outbox AS (
      INSERT INTO outbox_events (event_type, payload)
      SELECT
        'booking_confirmed',
        jsonb_build_object(
          'booking_id', ins.id,
          'customer_id', ins.customer_id,
          'event_id',   ins.event_id
        )
      FROM ins
    )
    SELECT * FROM ins
  `;

  const { rows } = await query(sql, [eventId, customerId, ticketsCount, idempotencyKey, requestHash]);
  return rows[0] || null;
}

/**
 * Determine why atomicBook returned null.
 * Returns 'NOT_FOUND' | 'EVENT_STARTED' | 'SOLD_OUT'
 */
async function diagnoseFailure(eventId, ticketsCount) {
  const { rows } = await query(
    `SELECT
       event_date > NOW() AS future,
       available_tickets >= $2 AS has_capacity
     FROM events
     WHERE id = $1`,
    [eventId, ticketsCount],
  );
  if (rows.length === 0) return 'NOT_FOUND';
  if (!rows[0].future) return 'EVENT_STARTED';
  return 'SOLD_OUT';
}

/**
 * Customer's own bookings, newest first.
 */
async function listMyBookings(customerId) {
  const { rows } = await query(
    `SELECT b.id, b.event_id, b.tickets_count, b.total_cents, b.status, b.created_at,
            e.title AS event_title, e.venue, e.event_date, e.price_cents
     FROM bookings b
     JOIN events e ON e.id = b.event_id
     WHERE b.customer_id = $1
     ORDER BY b.created_at DESC`,
    [customerId],
  );
  return rows;
}

module.exports = { findExistingBooking, atomicBook, diagnoseFailure, listMyBookings };
