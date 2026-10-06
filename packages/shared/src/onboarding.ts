import { z } from 'zod';
import { createPropertySchema } from './schemas.js';
import { unitPatternSchema } from './bulk-units.js';

export const finishOnboardingSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('skip') }).strict(),
  z
    .object({
      action: z.literal('create'),
      property: createPropertySchema.omit({ ownerId: true }),
      ownerName: z.string().trim().min(2).max(160).optional(),
      units: unitPatternSchema.optional(),
    })
    .strict(),
]);
