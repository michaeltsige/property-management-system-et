/**
 * Rate limiting behaviour, tested with a deliberately tiny limit.
 *
 * The auth routes use the same factory with production settings; this test pins
 * the contract (429 + standard headers + `RATE_LIMITED` code) so a dependency
 * upgrade cannot silently remove the protection.
 */

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../middleware/rate-limit.js';

function appWithLimit(max: number) {
  const app = express();
  app.use(express.json());
  app.use(createRateLimiter({ windowMs: 60_000, max }));
  app.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ message: (error as Error).message });
  });
  return app;
}

describe('rate limiting', () => {
  it('allows up to the limit, then answers 429 with a machine-readable code', async () => {
    const app = appWithLimit(3);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await request(app).get('/ping').expect(200);
      expect(response.headers['ratelimit-limit']).toBe('3');
      expect(response.headers['ratelimit-remaining']).toBe(String(3 - attempt));
    }

    const blocked = await request(app).get('/ping').expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('keeps the auth limiter configured with a real limit in production settings', async () => {
    // Guards against someone "fixing" a flaky test by disabling the limiter.
    const { authRateLimiter } = await import('../routes/auth.js');
    expect(typeof authRateLimiter).toBe('function');
    const { getConfig } = await import('../config.js');
    expect(getConfig().RATE_LIMIT_AUTH_MAX).toBeGreaterThan(0);
  });
});
