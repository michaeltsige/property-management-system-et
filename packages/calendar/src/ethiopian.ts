/**
 * Ethiopian calendar (አማርኛ ዘመን አቆጣጠር / Amete Mihret) conversions.
 *
 * Structure
 * ---------
 * - 13 months: 12 months of 30 days, plus Pagume (ጳጉሜን) with 5 days, or 6 in a
 *   leap year. Total 365 days, 366 in a leap year.
 * - A year is leap when `year mod 4 === 3` (e.g. 2011, 2015, 2019 E.C.).
 * - New year (1 Meskerem) falls on 11 September in the Gregorian calendar, or
 *   12 September when the *following* Gregorian year is a leap year.
 *
 * How the epoch was established
 * -----------------------------
 * `ETHIOPIAN_EPOCH_JDN` is **not** copied from a table. It was derived by
 * comparing ICU's independent `ethiopic` calendar implementation
 * (`Intl.DateTimeFormat('en-u-ca-ethiopic')`) against Gregorian JDN values for 20
 * dates spread over 1900–2100: the offset `jdn - ethiopianSerial(date)` was
 * 1724221 for every sample. `ethiopian.test.ts` keeps and widens that check
 * (every 7th day plus all Pagume days), and ICU is what the browser will use to
 * render dates too, so the two agree by construction.
 *
 * Note: some published tables describe the era as beginning on 29 August 8 C.E.
 * (Julian), which is one day later than this constant. See docs/DECISIONS.md
 * (ADR-0007). We deliberately follow ICU so that our math and the browser's
 * `Intl` output never disagree; the choice must be re-confirmed against published
 * Ethiopian conversion tables before any legal/dated document relies on it.
 */

import { jdnToGregorian, gregorianToJdn } from './jdn.js';
import type { LanguageCode } from './types.js';

/** 1 Meskerem 1 E.C. == 29 August 8 C.E. (Julian) == JDN 1724221. */
export const ETHIOPIAN_EPOCH_JDN = 1724221;

/** Ethiopian years supported by the validators (roughly 500–2600 C.E.). */
export const MIN_ETHIOPIAN_YEAR = 1;
export const MAX_ETHIOPIAN_YEAR = 9999;

export interface EthiopianDate {
  year: number;
  /** 1..12 regular months, 13 = Pagume (ጳጉሜን). */
  month: number;
  day: number;
}

export function isEthiopianLeapYear(year: number): boolean {
  return ((year % 4) + 4) % 4 === 3;
}

export function ethiopianDaysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 13) {
    throw new RangeError(`Ethiopian month out of range (1-13): ${month}`);
  }
  if (month <= 12) return 30;
  return isEthiopianLeapYear(year) ? 6 : 5;
}

export function isRealEthiopianDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < MIN_ETHIOPIAN_YEAR || year > MAX_ETHIOPIAN_YEAR) return false;
  if (!Number.isInteger(month) || month < 1 || month > 13) return false;
  return Number.isInteger(day) && day >= 1 && day <= ethiopianDaysInMonth(year, month);
}

/** Days elapsed in the calendar before 1 Meskerem of `year`. */
function daysBeforeEthiopianYear(year: number): number {
  // Leap years are those y ≡ 3 (mod 4); counting them for 1..year-1 gives floor(year/4).
  return 365 * (year - 1) + Math.floor(year / 4);
}

export function ethiopianToJdn(year: number, month: number, day: number): number {
  if (!isRealEthiopianDate(year, month, day)) {
    throw new RangeError(`Not a real Ethiopian date: ${year}-${month}-${day}`);
  }
  return ETHIOPIAN_EPOCH_JDN + daysBeforeEthiopianYear(year) + (month - 1) * 30 + (day - 1);
}

export function jdnToEthiopian(jdn: number): EthiopianDate {
  const days = jdn - ETHIOPIAN_EPOCH_JDN;
  if (days < 0)
    throw new RangeError(`Date is before the Ethiopian epoch (JDN ${ETHIOPIAN_EPOCH_JDN}): ${jdn}`);

  // 1461 = 4 years = 4 * 365 + 1 (one leap day); start from an estimate and correct.
  let year = Math.max(1, Math.floor((days * 4) / 1461) + 1);
  while (days >= daysBeforeEthiopianYear(year + 1)) year += 1;
  while (days < daysBeforeEthiopianYear(year)) year -= 1;

  const dayOfYear = days - daysBeforeEthiopianYear(year); // 0-based
  const month = Math.floor(dayOfYear / 30) + 1;
  const day = dayOfYear - (month - 1) * 30 + 1;
  return { year, month, day };
}

/** Ethiopian date -> Gregorian date. */
export function ethiopianToGregorian(year: number, month: number, day: number) {
  return jdnToGregorian(ethiopianToJdn(year, month, day));
}

/** Gregorian date -> Ethiopian date. */
export function gregorianToEthiopian(year: number, month: number, day: number): EthiopianDate {
  return jdnToEthiopian(gregorianToJdn(year, month, day));
}

/**
 * Month names.
 *
 * `am` and `ti` use Geʽez script (the calendar package ships them because the
 * date picker needs names even before the i18n package loads).
 * `om` (Afaan Oromoo) month names for the *Ethiopian* calendar vary between
 * speakers and are **not** yet verified — treat as a draft until reviewed by a
 * native speaker in the i18n phase.
 */
export const ETHIOPIAN_MONTH_NAMES: Record<LanguageCode, readonly string[]> = {
  en: [
    'Meskerem',
    'Tikimt',
    'Hidar',
    'Tahsas',
    'Tir',
    'Yekatit',
    'Megabit',
    'Miazia',
    'Ginbot',
    'Sene',
    'Hamle',
    'Nehase',
    'Pagume',
  ],
  am: ['መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜን'],
  om: [
    'Amajjii',
    'Guraandhala',
    'Bitooteessa',
    'Elba',
    'Caamsa',
    'Waxabajjii',
    'Adooleessa',
    'Hagayya',
    'Fuulbana',
    'Onkololeessa',
    'Sadaasa',
    'Muddee',
    'Qaraasa', // TODO(i18n): verify Pagume naming in Afaan Oromoo with a native speaker.
  ],
  ti: ['መስከረም', 'ጥቅምቲ', 'ኅዳር', 'ታሕሳስ', 'ጥሪ', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰነ', 'ሓምለ', 'ነሓሰ', 'ጳጉሜ'],
};

export function ethiopianMonthName(month: number, language: LanguageCode = 'en'): string {
  const names = ETHIOPIAN_MONTH_NAMES[language] ?? ETHIOPIAN_MONTH_NAMES.en;
  const name = names[month - 1];
  if (!name) throw new RangeError(`Ethiopian month out of range (1-13): ${month}`);
  return name;
}

/** Ethiopian New Year (1 Meskerem) as a Gregorian date. */
export function ethiopianNewYearGregorian(year: number) {
  return jdnToGregorian(ethiopianToJdn(year, 1, 1));
}
