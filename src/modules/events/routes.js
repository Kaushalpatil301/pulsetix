'use strict';

const { Router } = require('express');
const { asyncHandler } = require('../../middleware/errorHandler');
const { authenticate } = require('../../middleware/authenticate');
const { requireRole } = require('../../middleware/requireRole');
const { validate } = require('../../middleware/validate');
const {
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
} = require('./schemas');
const service = require('./service');

const router = Router();

// GET /api/events  — public
router.get(
  '/',
  validate(listEventsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { limit, offset } = req.query;
    const result = await service.listEvents({ limit, offset });
    res.json(result);
  }),
);

// GET /api/events/:id  — public
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const event = await service.getEvent(req.params.id);
    res.json(event);
  }),
);

// POST /api/events  — ORGANIZER only
router.post(
  '/',
  authenticate,
  requireRole('ORGANIZER'),
  validate(createEventSchema),
  asyncHandler(async (req, res) => {
    const event = await service.createEvent(req.user.id, req.body);
    res.status(201).json(event);
  }),
);

// PATCH /api/events/:id  — owning ORGANIZER only
router.patch(
  '/:id',
  authenticate,
  requireRole('ORGANIZER'),
  validate(updateEventSchema),
  asyncHandler(async (req, res) => {
    const event = await service.updateEvent(req.params.id, req.user.id, req.body);
    res.json(event);
  }),
);

// GET /api/events/:id/bookings  — owning ORGANIZER only
router.get(
  '/:id/bookings',
  authenticate,
  requireRole('ORGANIZER'),
  asyncHandler(async (req, res) => {
    const rows = await service.getEventBookings(req.params.id, req.user.id);
    res.json({ data: rows, limit: 500, offset: 0 });
  }),
);

module.exports = router;
