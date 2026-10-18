'use strict';

const { z } = require('zod');

const bookSchema = z.object({
  tickets_count: z.number().int().min(1).max(10),
});

const idempotencyHeaderSchema = z.object({
  'idempotency-key': z.string().min(8).max(64),
});

module.exports = { bookSchema, idempotencyHeaderSchema };
