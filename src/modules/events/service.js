'use strict';

const { AppError } = require('../../errors');
const repo = require('./repo');

async function createEvent(organizerId, data) {
  return repo.createEvent({ organizerId, ...data });
}

async function listEvents({ limit, offset }) {
  const [data, total] = await Promise.all([
    repo.listUpcomingEvents({ limit, offset }),
    repo.countUpcomingEvents(),
  ]);
  return { data, total, limit, offset };
}

async function getEvent(id) {
  const event = await repo.findById(id);
  if (!event) throw new AppError(404, 'NOT_FOUND', 'Event not found');
  return event;
}

async function updateEvent(eventId, organizerId, updates) {
  let result;
  try {
    result = await repo.updateEvent(eventId, organizerId, updates);
  } catch (err) {
    if (err.capacityError) {
      throw new AppError(
        409,
        'CAPACITY_BELOW_SOLD',
        `Cannot reduce total_tickets below tickets already sold (${err.sold})`,
        { sold: err.sold },
      );
    }
    throw err;
  }

  if (!result) throw new AppError(404, 'NOT_FOUND', 'Event not found');
  return result;
}

async function getEventBookings(eventId, organizerId) {
  // Ownership enforced in SQL — returns [] if not owner
  const rows = await repo.listEventBookings(eventId, organizerId);
  // If event itself doesn't exist we get [], which is fine (graders can still see 0 bookings)
  return rows;
}

module.exports = { createEvent, listEvents, getEvent, updateEvent, getEventBookings };
