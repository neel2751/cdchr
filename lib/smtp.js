/**
 * The hostname an SMTP account actually connects to.
 *
 * `host` holds either a real hostname or the sentinel `"other"`, in which case
 * the hostname the user typed is in `otherHost`. Anything that connects with,
 * or displays, `smtp.host` without resolving the sentinel first is broken for
 * every company on a custom mail server — it tries to reach a machine literally
 * called "other".
 *
 * This was open-coded in exactly one place (tenantMail.js) and missing from the
 * four send/test paths in emailSMTP.js and from the accounts table. One
 * function, so the next caller cannot forget.
 */
export function resolveSmtpHost(smtp) {
  if (!smtp) return "";
  return smtp.host === "other" ? smtp.otherHost || "" : smtp.host || "";
}

/**
 * Why this account cannot be used, or null if it is fine.
 *
 * Chiefly the case the form makes easy to reach: pick "Custom SMTP", leave the
 * hostname blank, and save an account that looks configured and can never send.
 */
export function smtpConfigError(smtp) {
  if (!smtp?.host) return "SMTP host is required.";
  if (smtp.host === "other" && !smtp.otherHost?.trim()) {
    return "Enter the custom SMTP host, or choose one of the listed providers.";
  }
  return null;
}
