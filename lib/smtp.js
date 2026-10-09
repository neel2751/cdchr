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
 * The deployment's own mailbox, read from the environment.
 *
 * The last resort in the sender chain (see server/email/tenantMail.js) and the
 * only sender platform-level mail has at all: a signup confirmation belongs to
 * no company yet, so it can never match a configured account.
 *
 * `secure` is derived from the port rather than configured next to it. 465 is
 * TLS from the first byte while every other port opens in the clear and
 * upgrades through STARTTLS, so a port and a `secure` that disagree do not
 * degrade — they hang until the socket times out. Two callers had `587` and
 * `false` written in literally and never read EMAIL_PORT, which is why a
 * deployment whose mailbox only listens on 465 could not send at all.
 *
 * Always returns an object; callers decide what a missing host means, since
 * "nothing is configured" is a different answer from "it failed to send".
 */
export function envSmtpConfig() {
  const port = Number(process.env.EMAIL_PORT) || 587;
  return {
    host: process.env.EMAIL_HOST || "",
    port,
    secure: port === 465,
    userName: process.env.EMAIL_USERNAME || "",
    password: process.env.EMAIL_PASSWORD || "",
  };
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
