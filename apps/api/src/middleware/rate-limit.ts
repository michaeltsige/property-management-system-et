/**
 * Rate limiting.
 *
 * Auth endpoints are the only unauthenticated paths that touch the database, so
 * they are limited per IP. The limiter is built by a factory rather than created
 * inline, because tests need to construct one with a tiny limit to prove the
 * behaviour without waiting 15 minutes.
 */

import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  message?: string;
}

export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: options.message ?? 'Too many requests. Please try again later.',
      },
    },
  });
}
