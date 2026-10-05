/**
 * Auth routes.
 *
 * Rate limited hard: these are the only unauthenticated endpoints that touch the
 * database, and the brief requires rate limiting on auth.
 */

import { Router } from 'express';
import { z } from 'zod';

import { loginSchema, refreshTokenSchema, registerSchema } from '@pms/shared';

import { getConfig } from '../config.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/context.js';
import { login, logout, refresh, registerOrganization } from '../services/auth.service.js';

const config = getConfig();

export const authRateLimiter = createRateLimiter({
  windowMs: config.RATE_LIMIT_AUTH_WINDOW_MS,
  max: config.RATE_LIMIT_AUTH_MAX,
  message: 'Too many authentication attempts. Please try again later.',
});

export const authRouter = Router();

authRouter.post('/register', authRateLimiter, validate({ body: registerSchema }), async (req, res, next) => {
  try {
    const result = await registerOrganization(req.body, {
      requestId: req.requestId,
      ip: req.ip ?? undefined,
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', authRateLimiter, validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const result = await login(req.body, {
      requestId: req.requestId,
      ip: req.ip ?? undefined,
      userAgent: req.header('user-agent') ?? undefined,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.post(
  '/refresh',
  authRateLimiter,
  validate({ body: refreshTokenSchema }),
  async (req, res, next) => {
    try {
      const tokens = await refresh(req.body.refreshToken, {
        requestId: req.requestId,
        ip: req.ip ?? undefined,
        userAgent: req.header('user-agent') ?? undefined,
      });
      res.json({ tokens });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  '/logout',
  requireAuth,
  validate({ body: z.object({ refreshToken: z.string().optional() }) }),
  async (req, res, next) => {
    try {
      await logout(req.body.refreshToken, req.auth?.userId ?? '', req.auth?.organizationId ?? '');
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

/** Current principal: the web app uses this to render the right navigation. */
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.auth });
});
