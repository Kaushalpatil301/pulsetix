'use strict';

const { Router } = require('express');
const { asyncHandler } = require('../../middleware/errorHandler');
const { validate } = require('../../middleware/validate');
const { authLimiter } = require('../../middleware/rateLimit');
const { registerSchema, loginSchema } = require('./schemas');
const service = require('./service');

const router = Router();

// POST /api/auth/register
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { user, token } = await service.register(req.body);
    res.status(201).json({ user, token });
  }),
);

// POST /api/auth/login
router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { user, token } = await service.login(req.body);
    res.status(200).json({ user, token });
  }),
);

module.exports = router;
