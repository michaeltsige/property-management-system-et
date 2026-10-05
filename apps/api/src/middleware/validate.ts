/**
 * Zod validation for params, query and body.
 *
 * Every endpoint validates its input; the parsed (and therefore normalised) value
 * replaces the raw input, so services never see an unvalidated string.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Replace a property that Express 5 defines as a getter only.
 *
 * `req.query` is lazily parsed from the URL by the router and cannot be assigned
 * (`TypeError: Cannot set property query ... which has only a getter`), so an own
 * property is defined which shadows it with the parsed value.
 */
function override(req: Request, key: 'query' | 'params', value: unknown): void {
  Object.defineProperty(req, key, { value, writable: true, configurable: true, enumerable: true });
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) override(req, 'params', schemas.params.parse(req.params));
      if (schemas.query) override(req, 'query', schemas.query.parse(req.query));
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}
