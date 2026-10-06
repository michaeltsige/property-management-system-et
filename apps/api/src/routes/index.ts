/**
 * API surface, mounted under `/api/v1`.
 *
 * The version prefix exists from day one because a mobile app will consume this
 * same API and must not be broken by web-only changes.
 */

import { Router } from 'express';

import { hierarchyRouter } from './hierarchy.js';
import { bulkUnitsRouter } from './bulk-units.js';
import { authRouter } from './auth.js';
import { healthRouter } from './health.js';
import { moneyRouter } from './money.js';
import { operationsRouter } from './operations.js';
import { organizationsRouter } from './organizations.js';
import { portfolioRouter } from './portfolio.js';
import { reportsRouter } from './reports.js';
import { translationsRouter } from './translations.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/organizations', organizationsRouter);
apiRouter.use('/translations', translationsRouter);
apiRouter.use('/', hierarchyRouter);
apiRouter.use('/', bulkUnitsRouter);
apiRouter.use('/', portfolioRouter);
apiRouter.use('/', moneyRouter);
apiRouter.use('/', operationsRouter);
apiRouter.use('/', reportsRouter);
