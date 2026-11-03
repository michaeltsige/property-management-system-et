/**
 * HTML email layout for transactional mail (invites, verification codes,
 * password resets).
 *
 * The translated plain text stays the text/plain part (unchanged behaviour);
 * this module wraps the same content in a structured, email-client-safe HTML
 * part: a branded card with a heading, an optional primary-button CTA, a
 * highlighted verification code block and a plain-link fallback. Everything is
 * table-based with inline styles because Gmail/Outlook strip <style> blocks,
 * and every interpolated string is HTML-escaped before it touches the template.
 */

/** Brand-600 from the app's design tokens (apps/web globals.css). */
const BRAND = '#1d6753';
const BRAND_DARK = '#175343';
const BRAND_WASH = '#eef7f3';
const BRAND_LINE = '#d3ebe1';
const INK = '#12251e';
const BODY = '#3f524c';
const MUTED = '#6b7f78';
const FAINT = '#93a5a0';
const CANVAS = '#f2f5f4';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface EmailHtmlParams {
  /** The subject line doubles as the card heading. */
  heading: string;
  /** One or two short paragraphs under the heading. */
  paragraphs: string[];
  /** A big, letter-spaced verification/reset code block. */
  code?: string;
  /** Small caption above the code block. */
  codeCaption?: string;
  /** Primary action button (invite link, prefilled verify/reset page). */
  cta?: { label: string; href: string };
  /** Plain-text URL under the button, for clients that block buttons. */
  fallbackLink?: { caption: string; href: string };
  /** Expiry / ignore-this-email note at the bottom of the card. */
  note?: string;
  /** Localized footer line ("This is an automated message from {appName}."). */
  footer?: string;
  appName: string;
}

export function renderEmailHtml(params: EmailHtmlParams): string {
  const paragraphs = params.paragraphs
    .filter((paragraph) => paragraph.trim().length > 0)
    .map(
      (paragraph) =>
        `<tr><td style="padding:0 28px 14px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:${BODY};">${escapeHtml(paragraph)}</td></tr>`,
    )
    .join('');

  const codeBlock = params.code
    ? `<tr><td style="padding:6px 28px 18px 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
    <p style="margin:0 0 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:0.4px;text-transform:uppercase;color:${MUTED};">${escapeHtml(params.codeCaption ?? 'Your code')}</p>
    <div style="display:inline-block;padding:14px 28px;background:${BRAND_WASH};border:1px solid ${BRAND_LINE};border-radius:10px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:30px;font-weight:700;letter-spacing:10px;text-indent:10px;color:${BRAND_DARK};">${escapeHtml(params.code)}</div>
  </td></tr></table>
</td></tr>`
    : '';

  const ctaBlock = params.cta
    ? `<tr><td style="padding:4px 28px 16px 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${BRAND}" style="border-radius:8px;">
    <a href="${escapeHtml(params.cta.href)}" style="display:inline-block;padding:13px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(params.cta.label)}</a>
  </td></tr></table>
</td></tr>`
    : '';

  const fallbackBlock = params.fallbackLink
    ? `<tr><td style="padding:0 28px 14px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${MUTED};">
  ${escapeHtml(params.fallbackLink.caption)}<br>
  <span style="color:${FAINT};word-break:break-all;">${escapeHtml(params.fallbackLink.href)}</span>
</td></tr>`
    : '';

  const noteBlock = params.note
    ? `<tr><td style="padding:2px 28px 20px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;color:${MUTED};">${escapeHtml(params.note)}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(params.heading)}</title></head>
<body style="margin:0;padding:0;background:${CANVAS};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid ${BRAND_LINE};border-radius:14px;overflow:hidden;">
    <tr><td style="padding:20px 28px;border-bottom:1px solid ${BRAND_WASH};">
      <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:${BRAND};">${escapeHtml(params.appName)}</span>
    </td></tr>
    <tr><td style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr>
    <tr><td style="padding:0 28px 16px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:21px;font-weight:700;line-height:1.3;color:${INK};">${escapeHtml(params.heading)}</td></tr>
    ${paragraphs}
    ${codeBlock}
    ${ctaBlock}
    ${fallbackBlock}
    ${noteBlock}
    <tr><td style="padding:16px 28px;border-top:1px solid ${BRAND_WASH};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${FAINT};">
      ${escapeHtml(params.footer ?? `This is an automated message from ${params.appName}.`)}
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
