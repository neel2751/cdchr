/**
 * The email senders this app can actually use.
 *
 * `feature` on an EmailAccount is not a free label — it is the key
 * `resolveAccount()` in server/email/tenantMail.js looks up when deciding which
 * SMTP account a message goes through. Only the values below are ever asked
 * for, so an account saved under anything else is never selected by anything
 * and silently does nothing.
 *
 * The form used to be a free-text box whose placeholder suggested "Invoice, HR
 * Bot" — neither of which the app has ever requested. Anyone following the
 * placeholder configured a sender that would never send.
 *
 * If a new feature key is introduced, add it here AND make some caller pass it
 * to sendTenantMail; one without the other is the bug this list exists to stop.
 *
 * What sends through what, as wired today:
 *
 *   HR        new office employee registration  server/officeServer/officeServer.js
 *             new site employee registration    server/employeServer/employeServer.js
 *             visa expiry reminders             server/visaServer/visaReminderJob.js
 *   Noreply   announcements and reminders       server/announcementServer/announcementDelivery.js
 *   All       password reset                    server/authServer/passwordResetServer.js
 *             sign-up and verification          server/authServer/signupServer.js
 *             account email                     server/authServer/authServer.js
 *   Accounts  invoices and expenses             NOT WIRED YET — see below
 *
 * "Accounts" is listed so it can be configured ahead of the invoice/expense mail
 * that will use it. Nothing passes it to sendTenantMail today, so an account
 * saved under it sits unused — harmless, because anything asking for a feature
 * with no account falls back to the company's default sender. This is the one
 * deliberate exception to the rule above; delete this note when it is wired.
 */
export const EMAIL_FEATURES = [
  {
    value: "All",
    label: "Default sender",
    description:
      "Used for anything without its own sender, and as the fallback when one " +
      "below is not configured. Also sends password resets and sign-up email.",
  },
  {
    value: "HR",
    label: "HR",
    description:
      "New employee registration and visa expiry reminders. Replies go to a person.",
  },
  {
    value: "Accounts",
    label: "Accounts",
    description: "Invoices and expense email.",
  },
  {
    value: "Noreply",
    label: "No-reply",
    description:
      "Announcements and other broadcasts nobody should reply to.",
  },
];

/**
 * The sender used when a feature has none of its own.
 *
 * resolveAccount() falls back to this before dropping to the platform-level
 * sender, so a company that configures only a default sender keeps its own
 * identity on every message. Without it, adding a feature key here would
 * silently move that mail onto the platform's EMAIL_* credentials.
 */
export const DEFAULT_EMAIL_FEATURE = "All";

export const EMAIL_FEATURE_VALUES = EMAIL_FEATURES.map((f) => f.value);

/** Is this a feature the app will ever ask for? */
export function isKnownEmailFeature(value) {
  return EMAIL_FEATURE_VALUES.includes(value);
}

export const EMAIL_FEATURE_LABEL = Object.fromEntries(
  EMAIL_FEATURES.map((f) => [f.value, f.label])
);
