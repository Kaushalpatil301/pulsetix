'use strict';

const { z } = require('zod');

const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  venue: z.string().min(1).max(300),
  event_date: z.string().datetime({ offset: true }).refine(
    (d) => new Date(d) > new Date(),
    { message: 'event_date must be in the future' },
  ),
  price_cents: z.number().int().min(0),
  total_tickets: z.number().int().min(1),
});

const updateEventSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    venue: z.string().min(1).max(300).optional(),
    event_date: z
      .string()
      .datetime({ offset: true })
      .refine((d) => new Date(d) > new Date(), {
        message: 'event_date must be in the future',
      })
      .optional(),
    price_cents: z.number().int().min(0).optional(),
    total_tickets: z.number().int().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

const listEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

module.exports = { createEventSchema, updateEventSchema, listEventsQuerySchema };
