/**
 * Minimal PDF receipt generation.
 *
 * The decision this implements (ADR-0028): receipts are generated server-side
 * with `pdfkit` and the **self-hosted Noto Sans Ethiopic** fonts — the same
 * family the web app loads (ADR-0012). Ethiopic text renders natively; there is
 * no transliteration and no "????" placeholder in a legal document. The fonts
 * live in `assets/fonts/` under the SIL OFL 1.1 (see `assets/fonts/OFL.txt`)
 * and are attributed in `THIRD_PARTY_NOTICES.md`.
 *
 * Layout is deliberately boring: a single A4 page, one accent rule, a table of
 * allocations and a totals block. A receipt is a legal record, not a poster —
 * the UI rule against decorative styling applies double here.
 */

import PDFDocument from 'pdfkit';

import { getCurrency } from '@pms/shared';

import { fileURLToPath } from 'node:url';

export interface ReceiptLine {
  /** Human description of what was paid, e.g. "Rent · period 2019-01". */
  label: string;
  amountMinor: bigint;
}

export interface ReceiptData {
  organizationName: string;
  receiptNumber: string;
  paidAt: Date;
  currency: string;
  method: string;
  reference?: string | null;
  tenantName: string;
  unitLabel?: string | null;
  propertyName?: string | null;
  lines: ReceiptLine[];
  totalMinor: bigint;
  allocatedMinor: bigint;
  unallocatedMinor: bigint;
}

// Fonts live outside src/, so the path is relative to the compiled file's own
// location: `src/lib/pdf.ts` (tsx dev) and `dist/lib/pdf.js` (tsc prod) both sit
// one directory below the app root, so `../../assets/fonts` works in both.
const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
const PAGE = { width: 595.28, height: 841.89, margin: 56 }; // A4 portrait, ~2 cm margins
const INK = '#1f2937';
const MUTED = '#6b7280';
const ACCENT = '#1d4ed8';

function formatMoney(minor: bigint, currency: string): string {
  const definition = getCurrency(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const major = abs / BigInt(definition.minorUnit);
  const fraction = abs % BigInt(definition.minorUnit);
  const digits = definition.decimals;
  const fractionText =
    digits > 0 ? `.${fraction.toString().padStart(digits, '0')}` : '';
  const grouped = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${definition.symbol} ${grouped}${fractionText}`;
}

function formatDateUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.toLocaleString('en', { month: 'long', timeZone: 'UTC' });
  return `${month} ${date.getUTCDate()}, ${year}`;
}

/**
 * Renders the receipt and resolves when the PDF is fully written. The caller
 * owns piping: pass a writable sink (a Buffer array, an HTTP response, …).
 */
export function renderReceiptPdf(data: ReceiptData, sink: NodeJS.WritableStream): Promise<void> {
  const document = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
    info: { Title: `Receipt ${data.receiptNumber}`, Creator: 'Property Management System ET' },
    pdfVersion: '1.4',
  });
  document.pipe(sink);

  document.registerFont('body', `${FONT_DIR}NotoSansEthiopic-Regular.ttf`);
  document.registerFont('body-bold', `${FONT_DIR}NotoSansEthiopic-Bold.ttf`);

  const contentWidth = PAGE.width - PAGE.margin * 2;

  // Header
  document.font('body-bold').fontSize(18).fillColor(INK).text(data.organizationName, {
    characterSpacing: 0.2,
  });
  document.font('body').fontSize(10).fillColor(MUTED).text('Payment receipt', { characterSpacing: 1.2 });
  document.moveDown(0.6);
  document.lineWidth(2).strokeColor(ACCENT).moveTo(PAGE.margin, document.y).lineTo(PAGE.margin + contentWidth, document.y).stroke();
  document.moveDown(1);

  // Identity block
  const row = (label: string, value: string, options: { bold?: boolean } = {}) => {
    const y = document.y;
    document.font('body').fontSize(10).fillColor(MUTED).text(label, PAGE.margin, y, { width: 150 });
    document.font(options.bold ? 'body-bold' : 'body').fontSize(11).fillColor(INK).text(value, PAGE.margin + 160, y, {
      width: contentWidth - 160,
    });
    document.y = y + 20;
    document.x = PAGE.margin;
  };

  row('Receipt number', data.receiptNumber, { bold: true });
  row('Paid on', formatDateUtc(data.paidAt));
  row('Method', data.method);
  if (data.reference) row('Reference', data.reference);
  row('Tenant', data.tenantName);
  if (data.unitLabel) {
    row('Unit', data.propertyName ? `${data.propertyName} · ${data.unitLabel}` : data.unitLabel);
  }
  document.moveDown(0.8);

  // Allocations table
  document.font('body-bold').fontSize(10).fillColor(MUTED).text('WHAT THIS PAYMENT SETTLES', {
    characterSpacing: 1,
  });
  document.moveDown(0.4);
  document.lineWidth(0.75).strokeColor('#d1d5db')
    .moveTo(PAGE.margin, document.y).lineTo(PAGE.margin + contentWidth, document.y).stroke();
  document.moveDown(0.5);

  if (data.lines.length === 0) {
    document.font('body').fontSize(11).fillColor(INK).text('No charges were outstanding; the full amount sits as a credit on the lease.');
    document.moveDown(0.5);
  }
  for (const line of data.lines) {
    const y = document.y;
    document.font('body').fontSize(11).fillColor(INK).text(line.label, PAGE.margin, y, { width: contentWidth - 150 });
    document.font('body').fontSize(11).fillColor(INK).text(
      formatMoney(line.amountMinor, data.currency),
      PAGE.margin + contentWidth - 150, y, { width: 150, align: 'right' },
    );
    document.y = y + 22;
    document.x = PAGE.margin;
  }
  document.moveDown(0.4);
  document.lineWidth(0.75).strokeColor('#d1d5db')
    .moveTo(PAGE.margin, document.y).lineTo(PAGE.margin + contentWidth, document.y).stroke();
  document.moveDown(0.6);

  // Totals
  row('Amount received', formatMoney(data.totalMinor, data.currency), { bold: true });
  row('Applied to charges', formatMoney(data.allocatedMinor, data.currency));
  if (data.unallocatedMinor > 0n) {
    row('Credit on the lease', formatMoney(data.unallocatedMinor, data.currency));
  }
  document.moveDown(1.4);

  document
    .font('body')
    .fontSize(9)
    .fillColor(MUTED)
    .text(
      'This receipt was generated by the property management system and reflects the ledger as of the date above. Keep it for your records.',
      PAGE.margin,
      PAGE.height - PAGE.margin - 40,
      { width: contentWidth, lineGap: 2 },
    );

  return new Promise((resolve, reject) => {
    document.on('end', resolve);
    document.on('error', reject);
    document.end();
  });
}
