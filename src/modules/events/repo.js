'use strict';

const { query, connect } = require('../../db/pool');

/**
 * @param {{ organizerId, title, description, venue, event_date, price_cents, total_tickets }} data
 */
async function createEvent({ organizerId, title, description, venue, event_date, price_cents, total_tickets }) {
  const { rows } = await query(
    `INSERT INTO events
       (organizer_id, title, description, venue, event_date, price_cents, total_tickets, available_tickets)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     RETURNING *`,
    [organizerId, title, description, venue, event_date, price_cents, total_tickets],
  );
  return rows[0];
}

/**
 * Upcoming events only, ordered by event_date, paginated.
 */
async function listUpcomingEvents({ limit, offset }) {
  const { rows } = await query(
    `SELECT id, organizer_id, title, description, venue, event_date,
            price_cents, total_tickets, available_tickets, version, updated_at
     FROM events
     WHERE event_date > NOW()
     ORDER BY event_date ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

async function countUpcomingEvents() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total FROM events WHERE event_date > NOW()`,
  );
  return rows[0].total;
}

async function findById(id) {
  const { rows } = await query(
    `SELECT id, organizer_id, title, description, venue, event_date,
            price_cents, total_tickets, available_tickets, version, updated_at
     FROM events WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * PATCH: update allowed fields, bump version, insert outbox row — all in one transaction.
 * Ownership guard: WHERE id=$1 AND organizer_id=$2.
 *
 * @param {string} eventId
 * @param {string} organizerId
 * @param {object} updates - subset of { title, description, venue, event_date, price_cents, total_tickets }
 * @returns {Promise<object|null>} updated event or null if not found / not owner
 */
async function updateEvent(eventId, organizerId, updates) {
  const client = await connect();
  try {
    await client.query('BEGIN');

    // Lock the row and check ownership in one shot
    const { rows: locked } = await client.query(
      `SELECT e.id, e.organizer_id, e.total_tickets, e.available_tickets,
              COALESCE(
                (SELECT SUM(b.tickets_count)
                 FROM bookings b
                 WHERE b.event_id = e.id AND b.status = 'CONFIRMED'),
                0
              )::int AS sold
       FROM events e
       WHERE e.id = $1 AND e.organizer_id = $2
       FOR UPDATE`,
      [eventId, organizerId],
    );

    if (locked.length === 0) {
      await client.query('ROLLBACK');
      return null; // not found OR not owner → 404 (don't reveal existence)
    }

    const current = locked[0];

    // Capacity guard
    if (updates.total_tickets !== undefined) {
      if (updates.total_tickets < current.sold) {
        await client.query('ROLLBACK');
        throw { capacityError: true, sold: current.sold };
      }
    }

    // Build dynamic SET clause
    const fields = [];
    const values = [];
    let idx = 1;

    for (const key of ['title', 'description', 'venue', 'event_date', 'price_cents']) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(updates[key]);
      }
    }
    if (updates.total_tickets !== undefined) {
      const newAvailable = updates.total_tickets - current.sold;
      fields.push(`total_tickets = $${idx++}`);
      values.push(updates.total_tickets);
      fields.push(`available_tickets = $${idx++}`);
      values.push(newAvailable);
    }

    fields.push(`version = version + 1`);
    fields.push(`updated_at = NOW()`);

    values.push(eventId);
    const { rows: updated } = await client.query(
      `UPDATE events SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );

    const updatedEvent = updated[0];

    // Determine which customer-visible fields changed (title, description, venue, event_date, price)
    const NOTIFY_FIELDS = ['title', 'description', 'venue', 'event_date', 'price_cents'];
    const changed = NOTIFY_FIELDS.filter((f) => updates[f] !== undefined);

    if (changed.length > 0) {
      // Outbox: notifies all booked customers
      await client.query(
        `INSERT INTO outbox_events (event_type, payload)
         VALUES ('event_updated', $1)`,
        [
          JSON.stringify({
            event_id: eventId,
            version: updatedEvent.version,
            changed_fields: changed,
          }),
        ],
      );
    }

    await client.query('COMMIT');
    return updatedEvent;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Bookings for an event owned by organizerId — latest 500.
 */
async function listEventBookings(eventId, organizerId) {
  const { rows } = await query(
    `SELECT b.id, b.customer_id, u.name AS customer_name, u.email AS customer_email,
            b.tickets_count, b.total_cents, b.status, b.created_at
     FROM bookings b
     JOIN users u ON u.id = b.customer_id
     JOIN events e ON e.id = b.event_id AND e.organizer_id = $2
     WHERE b.event_id = $1 AND b.status = 'CONFIRMED'
     ORDER BY b.created_at DESC
     LIMIT 500`,
    [eventId, organizerId],
  );
  return rows;
}

module.exports = {
  createEvent,
  listUpcomingEvents,
  countUpcomingEvents,
  findById,
  updateEvent,
  listEventBookings,
};
