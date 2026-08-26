/**
 * The branded shell every outgoing message is wrapped in.
 *
 * Replaces the hand-written HTML in server/email/email.js, which hardcoded one
 * company's name, logo and support address into mail sent on behalf of all of
 * them — and linked to http://localhost:3000.
 *
 * Deliberately plain: tables and inline styles, because email clients ignore
 * most of a stylesheet and many strip <style> entirely.
 */

/** Escape text that will sit inside HTML. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Only allow URLs that are safe as an href or img src. A tenant-supplied
 * "javascript:" logo URL would otherwise be rendered into every message.
 */
function safeUrl(value) {
  const url = String(value ?? "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return escapeHtml(url);
  // Root-relative assets only make sense once prefixed with the app's origin,
  // which the caller does; anything else (javascript:, data:) is dropped.
  return "";
}

/**
 * @param {object} options
 * @param {object} options.branding    from lib/tenant.js resolveBranding()
 * @param {string} options.companyName legal name, shown in the footer
 * @param {string} options.appUrl      absolute origin for links
 * @param {string} [options.heading]
 * @param {string} options.html        body, inserted as-is
 */
export function renderBrandedEmail({
  branding = {},
  companyName = "",
  appUrl = "",
  heading = "",
  html = "",
} = {}) {
  const appName = escapeHtml(branding.appName || "HR Management");
  const accent = escapeHtml(branding.primaryColor || "#4f46e5");
  const support = escapeHtml(branding.supportEmail || "");
  const footer = branding.emailFooterHtml || "";

  // A relative logo path is only reachable once made absolute.
  const rawLogo = branding.logoUrl || "";
  const logo = /^https?:\/\//i.test(rawLogo)
    ? safeUrl(rawLogo)
    : appUrl && rawLogo.startsWith("/")
      ? safeUrl(`${appUrl}${rawLogo}`)
      : "";

  const origin = safeUrl(appUrl);
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
        <tr><td style="padding:24px 28px 8px;text-align:center;">
          ${logo ? `<img src="${logo}" alt="" height="40" style="height:40px;max-width:180px;object-fit:contain;border:0;">` : ""}
          <div style="margin-top:8px;font-size:17px;font-weight:bold;color:#18181b;">${appName}</div>
        </td></tr>
        ${heading ? `<tr><td style="padding:12px 28px 0;"><h1 style="margin:0;font-size:18px;color:#18181b;">${escapeHtml(heading)}</h1></td></tr>` : ""}
        <tr><td style="padding:12px 28px 24px;font-size:14px;line-height:1.6;color:#3f3f46;">
          ${html}
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a;text-align:center;">
          ${footer}
          ${support ? `<div>Questions? <a href="mailto:${support}" style="color:${accent};">${support}</a></div>` : ""}
          ${origin ? `<div style="margin-top:6px;"><a href="${origin}" style="color:${accent};">${origin.replace(/^https?:\/\//, "")}</a></div>` : ""}
          <div style="margin-top:6px;">&copy; ${year} ${escapeHtml(companyName || appName)}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** A call-to-action button, for bodies that need one. */
export function emailButton(label, href, color = "#4f46e5") {
  const url = safeUrl(href);
  if (!url) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;">
    <tr><td style="border-radius:6px;background:${escapeHtml(color)};">
      <a href="${url}" style="display:inline-block;padding:10px 18px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;">${escapeHtml(label)}</a>
    </td></tr></table>`;
}
