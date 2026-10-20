import { describe, expect, it } from 'vitest';

import { statementTotals } from './portal';

/**
 * The rent-account strip's math: waived and written-off lines are money the
 * landlord gave up, so they stay out of "billed" — but payments recorded
 * against them still count as money that moved. "Amount due" is deliberately
 * NOT derived here: the server's dueMinor is the one number every screen
 * agrees on.
 */
describe('statementTotals', () => {
  it('returns zeros for an empty account', () => {
    expect(statementTotals([])).toEqual({ billedMinor: 0, paidMinor: 0 });
  });

  it('sums billed and paid across collectible charges', () => {
    expect(
      statementTotals([
        { amountMinor: '500000', paidMinor: '500000', status: 'paid' },
        { amountMinor: '500000', paidMinor: '200000', status: 'partial' },
        { amountMinor: '500000', paidMinor: '0', status: 'open' },
      ]),
    ).toEqual({ billedMinor: 1500000, paidMinor: 700000 });
  });

  it('excludes waived and written-off lines from billed, not from paid', () => {
    expect(
      statementTotals([
        { amountMinor: '300000', paidMinor: '300000', status: 'paid' },
        { amountMinor: '250000', paidMinor: '0', status: 'waived' },
        { amountMinor: '100000', paidMinor: '50000', status: 'written_off' },
      ]),
    ).toEqual({ billedMinor: 300000, paidMinor: 350000 });
  });
});
