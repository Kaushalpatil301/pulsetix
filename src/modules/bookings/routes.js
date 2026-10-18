'use strict';

const { Router } = require('express');
const { asyncHandler } = require('../../middleware/errorHandler');
const { authenticate } = require('../../middleware/authenticate');
const { requireRole } = require('../../middleware/requireRole');
const { validate } = require('../../middleware/validate');
const { bookingLimiter } = require('../../middleware/rateLimit');
const { bookSchema, idempotencyHeaderSchema } = require('./schemas');
const service = require('./service');

const router = Router();

// POST /api/events/:id/book  — CUSTOMER only
// Mounted under /api/events in app.js
router.post(
  '/:id/book',
  authenticate,
  requireRole('CUSTOMER'),
  bookingLimiter,
  validate(idempotencyHeaderSchema, 'headers'),
  validate(bookSchema),
  asyncHandler(async (req, res) => {
    const { booking, isNew } = await service.bookTickets({
      customerId: req.user.id,
      eventId: req.params.id,
      ticketsCount: req.body.tickets_count,
      idempotencyKey: req.headers['idempotency-key'],
    });

    res.status(isNew ? 201 : 200).json(booking);
  }),
);

// GET /api/bookings/me  — CUSTOMER only
// Mounted separately under /api/bookings in app.js
const meRouter = Router();
meRouter.get(
  '/me',
  authenticate,
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const rows = await service.myBookings(req.user.id);
    res.json({ data: rows, limit: rows.length, offset: 0 });
  }),
);

module.exports = { bookRouter: router, meRouter };
