/**
 * Portal-domain helpers shared by the tenant screens (kept out of page files:
 * Next.js only allows specific exports there, and the math deserves tests of
 * its own).
 */

/**
 * The rent-account strip's math, over the already-fetched charge lines:
 * "billed" counts every charge that is still collectible (waived and
 * written-off lines are money the landlord gave up, not money the tenant
 * owes), "paid" is what has actually landed. "Amount due" is deliberately
 * NOT derived here — it comes from the server (`portalMe.dueMinor`), which
 * applies credit on account the same way the overview's balance does, so the
 * two screens always agree.
 */
export function statementTotals(items: { amountMinor: string; paidMinor: string; status: string }[]): {
  billedMinor: number;
  paidMinor: number;
} {
  let billedMinor = 0;
  let paidMinor = 0;
  for (const item of items) {
    if (item.status !== 'waived' && item.status !== 'written_off') {
      billedMinor += Number(item.amountMinor);
    }
    paidMinor += Number(item.paidMinor);
  }
  return { billedMinor, paidMinor };
}
