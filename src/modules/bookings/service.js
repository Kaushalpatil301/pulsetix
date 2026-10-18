'use strict';

const crypto = require('crypto');
const { AppError } = require('../../errors');
const repo = require('./repo');

/**
 * Build a SHA-256 of the request payload for idempotency mismatch detection.
 */
function hashRequest(eventId, ticketsCount) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ event_id: eventId, tickets_count: ticketsCount }))
    .digest('hex');
}

/**
 * Book tickets (V2 — atomic CTE, idempotent, outbox-driven email).
 *
 * @param {{ customerId, eventId, ticketsCount, idempotencyKey }} params
 * @returns {{ booking: object, isNew: boolean }}
 */
async function bookTickets({ customerId, eventId, ticketsCount, idempotencyKey }) {
  const requestHash = hashRequest(eventId, ticketsCount);

  // ── Fast-path idempotency check ─────────────────────────────────────────
  const existing = await repo.findExistingBooking(customerId, idempotencyKey);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new AppError(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency-Key was used with a different request payload',
      );
    }
    return { booking: existing, isNew: false };
  }

  // ── Atomic booking CTE ───────────────────────────────────────────────────
  let booking;
  try {
    booking = await repo.atomicBook({
      eventId,
      customerId,
      ticketsCount,
      idempotencyKey,
      requestHash,
    });
  } catch (err) {
    if (err.code === '23505') {
      // Concurrent twin won the race; re-read and return 200
      const won = await repo.findExistingBooking(customerId, idempotencyKey);
      if (won) return { booking: won, isNew: false };
    }
    throw err;
  }

  if (!booking) {
    // Inventory check failed — diagnose why
    const reason = await repo.diagnoseFailure(eventId, ticketsCount);
    if (reason === 'NOT_FOUND') {
      throw new AppError(404, 'NOT_FOUND', 'Event not found');
    }
    if (reason === 'EVENT_STARTED') {
      throw new AppError(409, 'EVENT_STARTED', 'Event has already started');
    }
    // SOLD_OUT — read current available for details
    const { rows } = await require('../../db/pool').query(
      'SELECT available_tickets FROM events WHERE id = $1',
      [eventId],
    );
    const available = rows[0]?.available_tickets ?? 0;
    throw new AppError(409, 'SOLD_OUT', 'Not enough tickets available', { available });
  }

  return { booking, isNew: true };
}

/**
 * @param {string} customerId
 */
async function myBookings(customerId) {
  return repo.listMyBookings(customerId);
}

module.exports = { bookTickets, myBookings };
