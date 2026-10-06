import { describe, expect, it } from 'vitest';
import { unitLabels, bulkUnitSchema } from './bulk-units.js';
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
});
