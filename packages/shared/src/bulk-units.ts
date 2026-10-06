import { z } from 'zod';
import { createUnitSchema } from './schemas.js';

export const unitPatternSchema = z
  .object({
    pattern: z
      .string()
      .trim()
      .min(3)
      .max(50)
      .refine(
        (s) =>
          (s.match(/\{n\}/g) ?? []).length === 1 &&
          !/[{}]/.test(s.replace('{n}', '')) &&
          !Array.from(s).some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127),
        'Use exactly one {n} placeholder and no other braces or control characters',
      ),
    start: z.number().int().min(0).max(999999),
    count: z.number().int().min(1).max(200),
    padding: z.number().int().min(1).max(6).default(1),
  })
  .refine((v) => v.start + v.count - 1 <= 999999, 'Last number must not exceed 999999');

export const bulkUnitSchema = z
  .object({
    ...createUnitSchema.omit({ label: true, status: true }).shape,
    naming: unitPatternSchema,
  })
  .strict();

export type UnitPattern = z.input<typeof unitPatternSchema>;
/** Same bounded preview in browser and API; never evaluate a template as code. */
export function unitLabels(input: UnitPattern): string[] {
  const naming = unitPatternSchema.parse(input);
  return Array.from({ length: naming.count }, (_, i) =>
    naming.pattern.replace('{n}', String(naming.start + i).padStart(naming.padding, '0')),
  );
}
