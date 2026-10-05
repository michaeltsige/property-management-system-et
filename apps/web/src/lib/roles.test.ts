import { describe, expect, it } from 'vitest';

import { ROLE_KEYS, ROLE_LABEL_FALLBACK } from '@/lib/roles';

describe('role labels', () => {
  it('covers every role the API can put in a session', () => {
    expect([...ROLE_KEYS]).toEqual(['owner_admin', 'manager', 'accountant', 'maintenance', 'tenant']);
  });

  it('has a fallback that is not a raw translation key', () => {
    expect(ROLE_LABEL_FALLBACK).not.toMatch(/^role\./);
    expect(ROLE_LABEL_FALLBACK.length).toBeGreaterThan(0);
  });
});
