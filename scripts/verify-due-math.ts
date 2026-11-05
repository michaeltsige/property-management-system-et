/**
 * Standalone proof of the billing math behind the portal "Pay now" amount.
 *
 * Reproduces the demo seed's partial payer (MEG G-02: ETB 28,000/month,
 * Ethiopian calendar, due on the 1st, seed behavior = pay 70% of every bill on
 * the due date, catch up fully every third bill) with the REAL engine from
 * apps/api/src/services/charges.ts, then prints the exact composition of the
 * tenant's outstanding balance.
 *
 * Run: pnpm exec tsx scripts/verify-due-math.ts   (repo root, packages built)
 */
import { civilToUtcDate, type CalendarKind } from '@pms/calendar';

import {
  amountForCycle,
  cycleWindowFor,
  isChargingPeriod,
} from '../apps/api/src/services/charges.js';

type LeaseSeed = {
  billingCalendar: string;
  billingFrequency: 'monthly';
  rentAmountMinor: bigint;
  currency: string;
  startDate: Date;
  endDate: Date | null;
  escalationPercent: null;
  escalationEveryMonths: null;
};

const lease = (startCivil: { year: number; month: number; day: number }, endDate?: Date): LeaseSeed => ({
  billingCalendar: 'ethiopian',
  billingFrequency: 'monthly',
  rentAmountMinor: 2_800_000n, // ETB 28,000.00
  currency: 'ETB',
  startDate: civilToUtcDate({ calendar: 'ethiopian', ...startCivil }),
  endDate: endDate ?? null,
  escalationPercent: null,
  escalationEveryMonths: null,
});

function etb(minor: bigint): string {
  const negative = minor < 0n;
  const abs = (negative ? -minor : minor).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

function label(civil: { calendar: CalendarKind; year: number; month: number; day: number }): string {
  const months = [
    '', 'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit',
    'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehasse', 'Pagume',
  ];
  if (civil.calendar === 'ethiopian') {
    return `${months[civil.month] ?? civil.month} ${civil.day}`;
  }
  return `${civil.year}-${String(civil.month).padStart(2, '0')}-${String(civil.day).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Scenario: lease starts Sene 1, 2018 EC (five periods before Tikimt 2019-02).
// "Today" = Tikimt 26, 2019 EC (Nov 5, 2026 Gregorian).
// ---------------------------------------------------------------------------
const g02 = lease({ year: 2018, month: 10, day: 1 });

console.warn('=== Cycle engine: G-02 (ETB 28,000/month, EC calendar, anchor day 1) ===\n');

// Every period from the lease start through Tikimt 2019-02:
const periods: { year: number; month: number; key: string }[] = [];
for (let month = 10; month <= 12; month += 1) periods.push({ year: 2018, month, key: `2018-${String(month).padStart(2, '0')}` });
for (let month = 1; month <= 2; month += 1) periods.push({ year: 2019, month, key: `2019-0${month}` });
periods.push({ year: 2018, month: 13, key: '2018-13' }); // Pagume — must never bill

let chargeIndex = 0;
const chargeAmounts: bigint[] = [];
for (const period of periods) {
  const charging = isChargingPeriod(g02, { calendar: 'ethiopian', ...period });
  if (!charging) {
    console.warn(`${period.key.padEnd(9)}  not a charging period (Pagume rides free)`);
    continue;
  }
  const cycleIndex = chargeIndex;
  const window = cycleWindowFor(g02, cycleIndex);
  const amount = amountForCycle(g02, cycleIndex);
  chargeAmounts.push(amount);
  console.warn(
    `${period.key.padEnd(9)}  cycle ${cycleIndex}: ${label(window.start)} → ${label(window.end)}` +
      `  due ${label(window.start)}  amount ETB ${etb(amount)}`,
  );
  chargeIndex += 1;
}

console.warn(
  `\nEvery cycle is the FULL ETB 28,000.00, billed on the 1st — no "rent till today" proration anywhere.` +
    `\n(The only proration in the engine: the FINAL cycle truncated by the lease's endDate — see the end.)\n`,
);

// ---------------------------------------------------------------------------
// Seed payment behavior: 70% on the due date; every 3rd bill (index % 3 === 1)
// caught up in full two weeks later. The seed computes the 70% with FLOAT math
// (Math.floor(Number(amount) * 0.7) — 2,800,000 × 0.7 = 1,959,999.999…), which
// is where the odd santim in the demo data comes from. Shown both ways:
// ---------------------------------------------------------------------------
console.warn('=== Seed partial payer: 70% paid per bill, catch-up on bills 1 and 4 ===\n');

for (const mode of ['current seed (float 0.7)', 'integer 7/10 (fixed)'] as const) {
  const part70 = (amount: bigint): bigint =>
    mode === 'current seed (float 0.7)'
      ? BigInt(Math.floor(Number(amount) * 0.7))
      : (amount * 7n) / 10n;

  let outstanding = 0n;
  let perCycle = 0n;
  const lines: string[] = [];
  chargeAmounts.forEach((amount, index) => {
    const part = part70(amount);
    const caughtUp = index % 3 === 1;
    const remaining = caughtUp ? 0n : amount - part;
    if (!caughtUp) perCycle = remaining;
    outstanding += remaining;
    lines.push(
      `bill ${index}: charged ETB ${etb(amount)}, paid ETB ${etb(part)}` +
        (caughtUp ? ` + ETB ${etb(amount - part)} (caught up)` : '') +
        `  →  ETB ${etb(remaining)} left`,
    );
  });
  console.warn(`--- ${mode} ---`);
  console.warn(lines.join('\n'));
  console.warn(
    `3 open cycles → ETB ${etb(outstanding)}   |   4 open cycles → ETB ${etb(outstanding + perCycle)}\n`,
  );
  if (mode !== 'current seed (float 0.7)') continue;
  console.warn(
    `  ^ the float rounding leaves ETB 8,400.01 per cycle, not 8,400.00.` +
      `\n    4 × 8,400.01 = 33,600.04 — exactly the "Pay now" amount from the bug report.` +
      `\n    (How many cycles are open depends on when the demo seed last ran.)\n`,
  );
}

console.warn(`"Pay now" collects the stacked remainders of ALL still-open cycles — full months` +
  `\nbilled on the 1st, never broken days. The dashboard now itemizes them.\n`);

// ---------------------------------------------------------------------------
// The only proration that exists: the final cycle of a lease that ENDS.
// ---------------------------------------------------------------------------
console.warn('=== The one exception: a lease with an endDate ===\n');
const ending = lease({ year: 2018, month: 10, day: 1 }, civilToUtcDate({ calendar: 'ethiopian', year: 2019, month: 2, day: 27 }));
const lastWindow = cycleWindowFor(ending, 4);
console.warn(
  `lease ends Tikimt 27, 2019 → final cycle ${label(lastWindow.start)} → ${label(lastWindow.end)}` +
    ` covers 27 of 30 days → ETB ${etb(amountForCycle(ending, 4))} (27/30 × 28,000).`,
);
