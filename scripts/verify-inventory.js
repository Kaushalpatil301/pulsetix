'use strict';

require('dotenv').config();
const { query } = require('../src/db/pool');

async function verify() {
  const eventId = process.argv[2] || '1acc1f44-b5e4-4a26-895a-24276162d1b7';
  console.log('[verify] Checking event:', eventId);

  const res = await query(
    `SELECT e.id, e.total_tickets, e.available_tickets,
            COALESCE(SUM(b.tickets_count),0) AS booked,
            (COALESCE(SUM(b.tickets_count),0) + e.available_tickets) - e.total_tickets AS drift
     FROM events e LEFT JOIN bookings b ON b.event_id = e.id AND b.status='CONFIRMED'
     WHERE e.id = $1
     GROUP BY e.id`,
    [eventId]
  );
  console.log('--- INVENTORY INTEGRITY ---');
  console.table(res.rows);

  const dupes = await query(
    `SELECT customer_id, idempotency_key, COUNT(*) 
     FROM bookings 
     WHERE event_id = $1 
     GROUP BY 1,2 HAVING COUNT(*) > 1`,
    [eventId]
  );
  console.log('--- DUPLICATE BOOKINGS (MUST BE 0) ---');
  console.log('Duplicates count:', dupes.rows.length);

  const outbox = await query(
    `SELECT COUNT(*) AS total_outbox, 
            COUNT(*) FILTER (WHERE processed_at IS NOT NULL) as processed, 
            COUNT(*) FILTER (WHERE processed_at IS NULL) as pending 
     FROM outbox_events`
  );
  console.log('--- OUTBOX METRICS ---');
  console.table(outbox.rows);
  process.exit(0);
}

verify().catch((e) => {
  console.error(e);
  process.exit(1);
});
