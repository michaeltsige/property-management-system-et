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
          !/[{}]/.test(s.replace('{n}', '').replace('{f}', '')) &&
          !Array.from(s).some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127),
        'Use exactly one {n} placeholder and no other braces or control characters',
      ),
    start: z.number().int().min(0).max(999999),
    count: z.number().int().min(1).max(200),
    padding: z.number().int().min(1).max(6).default(1),
    /**
     * Floor-wise generation: when present, `count` units are created on each
     * listed floor and `{f}` in the pattern is replaced with the floor number
     * (e.g. pattern "{f}0{n}" with floors [3, 4], start 1 → 301, 302, 401, 402).
     * `perFloorCounts` overrides `count` per floor (floors can hold a different
     * number of units — "4, 4, 2" is a normal building); keys are floor numbers.
     */
    floors: z.array(z.number().int().min(-5).max(200)).min(1).max(60).optional(),
    perFloorCounts: z.record(z.string().regex(/^-?\d+$/), z.number().int().min(1).max(100)).optional(),
  })
  .refine((v) => v.start + v.count - 1 <= 999999, 'Last number must not exceed 999999')
  .refine(
    (v) => !v.pattern.includes('{f}') || v.floors !== undefined,
    'The pattern uses {f} — provide the floors list',
  )
  .refine(
    (v) => !v.floors || totalUnitsForFloors(v.floors, v.count, v.perFloorCounts) <= 200,
    'Floors × units per floor must not exceed 200 units',
  );

export type UnitPattern = z.input<typeof unitPatternSchema>;
export interface GeneratedUnitLabel {
  label: string;
  floor: number | null;
}

/** Units generated per floor: the per-floor override when present, else `count`. */
export function countForFloor(
  floor: number,
  count: number,
  perFloorCounts?: Record<string, number> | undefined,
): number {
  return perFloorCounts?.[String(floor)] ?? count;
}

export function totalUnitsForFloors(
  floors: readonly number[],
  count: number,
  perFloorCounts?: Record<string, number> | undefined,
): number {
  return floors.reduce((sum, floor) => sum + countForFloor(floor, count, perFloorCounts), 0);
}

export const bulkUnitSchema = z
  .object({
    ...createUnitSchema.omit({ label: true, status: true }).shape,
    naming: unitPatternSchema,
  })
  .strict();

function formatLabel(naming: { pattern: string; start: number; padding: number }, i: number, floor: number | null) {
  const n = String(naming.start + i).padStart(naming.padding, '0');
  let label = naming.pattern.replace('{n}', n);
  if (floor !== null) label = label.replace('{f}', String(floor));
  return label;
}

/**
 * Same bounded preview in browser and API; never evaluate a template as code.
 * Throws when the generated labels collide (the property-wide unique index
 * would reject the batch anyway).
 */
export function unitLabelsWithFloors(input: UnitPattern): GeneratedUnitLabel[] {
  const naming = unitPatternSchema.parse(input);
  // With {f} the numbering restarts on each floor (301, 302 / 401, 402 …);
  // without it the sequence continues across floors so labels stay unique.
  const restartPerFloor = naming.pattern.includes('{f}');
  let globalIndex = 0;
  const out: GeneratedUnitLabel[] = naming.floors
    ? naming.floors.flatMap((floor) => {
        const floorCount = countForFloor(floor, naming.count, naming.perFloorCounts);
        return Array.from({ length: floorCount }, (_, i) => {
          const index = restartPerFloor ? i : globalIndex++;
          return {
            label: formatLabel(naming, index, floor),
            floor: floor as number | null,
          };
        });
      })
    : Array.from({ length: naming.count }, (_, i) => ({
        label: formatLabel(naming, i, null),
        floor: null,
      }));
  const seen = new Set<string>();
  for (const unit of out) {
    if (seen.has(unit.label))
      throw new Error(
        `Generated unit labels are not unique ("${unit.label}" repeats) — adjust the pattern, start number or floors`,
      );
    seen.add(unit.label);
  }
  return out;
}

export function unitLabels(input: UnitPattern): string[] {
  return unitLabelsWithFloors(input).map((u) => u.label);
}
