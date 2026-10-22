import { describe, expect, it } from 'vitest';
import { unitLabels, unitLabelsWithFloors, bulkUnitSchema } from './bulk-units.js';
describe('bounded unit names', () => {
  it('generates a literal prefix/suffix with zero padding', () => {
    expect(unitLabels({ pattern: 'A-{n}-ET', start: 9, count: 3, padding: 3 })).toEqual([
      'A-009-ET',
      'A-010-ET',
      'A-011-ET',
    ]);
  });
  it.each(['A', '{n}{n}', '{floor}-{n}', '{n}\nX'])('rejects unsafe or ambiguous pattern %s', (pattern) => {
    expect(() => unitLabels({ pattern, start: 1, count: 2 })).toThrow();
  });
  it.each([
    { count: 201 },
    { count: 0 },
    { start: 999999, count: 2 },
    { padding: 7 },
    { start: -1 },
    { count: 1.5 },
  ])('rejects invalid bounds %o', (input) => {
    expect(() => unitLabels({ pattern: '{n}', start: 1, count: 2, ...input })).toThrow();
  });
  it('never accepts client-supplied organization or occupied status', () => {
    const input = {
      propertyId: 'aa0d568b-ff84-4e83-bbcd-56766933c9dd',
      naming: { pattern: '{n}', start: 1, count: 1 },
    };
    expect(bulkUnitSchema.safeParse({ ...input, status: 'occupied' }).success).toBe(false);
    expect(bulkUnitSchema.safeParse({ ...input, organizationId: input.propertyId }).success).toBe(false);
  });
  it('generates floor-based labels with {f} and assigns each unit its floor', () => {
    expect(
      unitLabelsWithFloors({ pattern: '{f}0{n}', start: 1, count: 2, padding: 1, floors: [3, 4] }),
    ).toEqual([
      { label: '301', floor: 3 },
      { label: '302', floor: 3 },
      { label: '401', floor: 4 },
      { label: '402', floor: 4 },
    ]);
  });
  it('keeps a global sequence when floors are given without {f} in the pattern', () => {
    expect(unitLabels({ pattern: 'A-{n}', start: 1, count: 2, padding: 3, floors: [1, 2] })).toEqual([
      'A-001',
      'A-002',
      'A-003',
      'A-004',
    ]);
  });
  it('rejects {f} without floors, floor overuse, and duplicate-generating patterns', () => {
    expect(() => unitLabels({ pattern: '{f}-{n}', start: 1, count: 2 })).toThrow();
    expect(() =>
      unitLabels({ pattern: '{f}-{n}', start: 1, count: 2, padding: 1, floors: Array.from({ length: 61 }, (_, i) => i) }),
    ).toThrow();
    expect(() => unitLabels({ pattern: '{f}', start: 1, count: 2, padding: 1, floors: [1] })).toThrow();
    expect(() =>
      unitLabels({ pattern: '{f}-{n}', start: 1, count: 2, padding: 1, floors: [1, 2] }),
    ).not.toThrow();
  });
});
