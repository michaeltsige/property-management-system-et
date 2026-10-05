/**
 * Health and readiness.
 *
 * `/health` is liveness only (used by container orchestration); `/ready` checks
 * the database, because a process that cannot reach Postgres must not receive
 * traffic.
 */

import { Router } from 'express';

import { getConfig } from '../config.js';
import { getPrisma } from '../lib/prisma.js';

export const healthRouter = Router();

const startedAt = Date.now();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'pms-api',
    version: process.env.npm_package_version ?? '0.1.0',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    time: new Date().toISOString(),
  });
});

healthRouter.get('/ready', async (_req, res, next) => {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    res.json({
      status: 'ready',
      database: 'ok',
      jobs: getConfig().JOBS_ENABLED,
      paymentProvider: getConfig().PAYMENT_PROVIDER,
      smsProvider: getConfig().SMS_PROVIDER,
    });
  } catch (error) {
    next(error);
  }
});
