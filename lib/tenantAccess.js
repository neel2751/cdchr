/**
 * What a company may do today: use everything, look but not change, or nothing.
 *
 * A company that signs itself up starts on a free trial. When the trial ends
 * without a plan, it does not stop dead — the owner gets a few days to sort it
 * out with everything still working, then a few days where people can see and
 * export but not change anything, and only then is it locked:
 *
 *   trial ──(end date)──▶ grace ──(+7d)──▶ read-only ──(+7d)──▶ locked
 *
 * The platform admin can also lock a company, or make it read-only, by hand —
 * for an unpaid bill, say — and that wins over the dates. A suspended or
 * cancelled company is locked.
 *
 * Worked out from the company document every time, never stored: there is no
 * job that has to run for a trial to end, so a missed run can never leave a
 * company free for ever, and moving the end date is all it takes to extend one.
 *
 * Pure — no database — so the login, the proxy's status check, the admin shell
 * and the platform console all give the same answer, and the ladder can be
 * tested without a clock.
 *
 * NOT the legacy `isActive` toggle. A company's own super admin can switch
 * that from the Company screen, and treating it as a lock would let somebody
 * lock themselves out of their own account with one click.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The lengths of each stage. One place, so changing the trial from 14 days to
 * 30 is one edit.
 */
export const ACCESS_RULES = Object.freeze({
  trialDays: 14,
  graceDays: 7,
  readOnlyDays: 7,
});

/**
 * Levels, from most to least access. `grace` behaves exactly like `full`; it
 * only changes what the owner is told.
 */
export const ACCESS_LEVELS = ["full", "grace", "readOnly", "locked"];

/** Levels the platform admin can set by hand. */
export const MANUAL_LOCK_LEVELS = ["readOnly", "locked"];

/** When a trial started now should end. */
export function trialEndFrom(start = new Date(), days = ACCESS_RULES.trialDays) {
  return new Date(new Date(start).getTime() + days * DAY_MS);
}

/** Whole days from `now` until `date`, rounded up; negative once passed. */
function daysUntil(date, now) {
  return Math.ceil((new Date(date).getTime() - now.getTime()) / DAY_MS);
}

/**
 * The company's access right now.
 *
 * @param {object|null} company  needs status, delete, billing
 * @param {Date} [now]
 * @returns {{
 *   level: "full"|"grace"|"readOnly"|"locked",
 *   reason: "active"|"trial"|"trialEnded"|"manual"|"demo"|"suspended"|"cancelled",
 *   trialEndsAt: Date|null,
 *   daysLeft: number|null,   // in the trial, or until the next stage
 *   nextLevel: string|null,  // what happens next if nothing changes
 *   nextAt: Date|null,
 *   message: string,         // the platform admin's note, if any
 * }}
 */
export function companyAccess(company, now = new Date()) {
  const base = {
    trialEndsAt: null,
    daysLeft: null,
    nextLevel: null,
    nextAt: null,
    message: company?.billing?.lock?.message || "",
  };

  // No company — a platform admin, or an account from before tenancy. Nothing
  // to lock, and failing closed here would lock people out of nothing.
  if (!company) return { ...base, level: "full", reason: "active" };

  if (company.delete === true || company.status === "cancelled") {
    return { ...base, level: "locked", reason: "cancelled" };
  }
  if (company.status === "suspended") {
    return { ...base, level: "locked", reason: "suspended" };
  }

  const lock = company.billing?.lock;
  if (lock && MANUAL_LOCK_LEVELS.includes(lock.level)) {
    return { ...base, level: lock.level, reason: "manual" };
  }

  // A demo company (scripts/seed-demo.mjs): anybody shown it can look at
  // everything and change nothing, so it is the same tomorrow.
  if (company.billing?.demo) {
    return { ...base, level: "readOnly", reason: "demo" };
  }

  if (company.status !== "trial") {
    return { ...base, level: "full", reason: "active" };
  }

  const end = company.billing?.trialEndsAt
    ? new Date(company.billing.trialEndsAt)
    : null;
  // A trial with no end date predates this rule. Left running rather than
  // locked on the spot; scripts/set-trial-end-dates.mjs gives them one.
  if (!end || Number.isNaN(end.getTime())) {
    return { ...base, level: "full", reason: "trial" };
  }

  const readOnlyAt = new Date(end.getTime() + ACCESS_RULES.graceDays * DAY_MS);
  const lockedAt = new Date(
    readOnlyAt.getTime() + ACCESS_RULES.readOnlyDays * DAY_MS
  );
  const trial = { ...base, trialEndsAt: end };

  if (now < end) {
    return {
      ...trial,
      level: "full",
      reason: "trial",
      daysLeft: daysUntil(end, now),
      nextLevel: "grace",
      nextAt: end,
    };
  }
  if (now < readOnlyAt) {
    return {
      ...trial,
      level: "grace",
      reason: "trialEnded",
      daysLeft: daysUntil(readOnlyAt, now),
      nextLevel: "readOnly",
      nextAt: readOnlyAt,
    };
  }
  if (now < lockedAt) {
    return {
      ...trial,
      level: "readOnly",
      reason: "trialEnded",
      daysLeft: daysUntil(lockedAt, now),
      nextLevel: "locked",
      nextAt: lockedAt,
    };
  }
  return { ...trial, level: "locked", reason: "trialEnded" };
}

/** May people add and change things? */
export function canWrite(access) {
  return access?.level === "full" || access?.level === "grace";
}

/**
 * May this person sign in and use the app? A locked company's super admin may
 * still sign in — to the page that says why, and what to do about it.
 */
export function canEnter(access, role) {
  if (access?.level !== "locked") return true;
  return role === "superAdmin";
}

/**
 * One line for a banner or the platform console, in plain words.
 *
 * @param {object} access from companyAccess()
 * @param {{ owner?: boolean }} [opts] the owner is told what to do; everybody
 *   else is told who to ask
 */
export function describeAccess(access, { owner = false } = {}) {
  if (!access) return "";
  const date = (d) =>
    d
      ? new Date(d).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
        })
      : "";
  const days = (n) => `${n} day${n === 1 ? "" : "s"}`;
  const ask = owner ? "Choose a plan to keep going" : "Please speak to your manager";

  switch (access.reason) {
    case "trial":
      return access.daysLeft
        ? `Your free trial ends in ${days(access.daysLeft)} (${date(access.trialEndsAt)}).`
        : "You are on a free trial.";
    case "trialEnded":
      if (access.level === "grace") {
        return `Your free trial has ended. Everything keeps working until ${date(access.nextAt)}, then it becomes read-only. ${ask}.`;
      }
      if (access.level === "readOnly") {
        return `Your free trial has ended, so this account is read-only: you can view and export, but not add or change anything. It will be locked on ${date(access.nextAt)}. ${ask}.`;
      }
      return `Your free trial has ended and this account is locked. ${ask}.`;
    case "manual":
      return access.level === "readOnly"
        ? `This account is read-only: you can view and export, but not add or change anything.${access.message ? ` ${access.message}` : ""}`
        : `This account is locked.${access.message ? ` ${access.message}` : ""}`;
    case "demo":
      return "This is a demo company filled with sample data. Look around as much as you like — adding and changing things is switched off.";
    case "suspended":
      return `This account is paused.${access.message ? ` ${access.message}` : ""}`;
    case "cancelled":
      return "This account has been closed.";
    default:
      return "";
  }
}

/**
 * The trial reminder emails, in order. Each is sent once
 * (server/tenantServer/trialReminderJob.js); `due` says whether the company is
 * at or past that point.
 */
export const TRIAL_REMINDERS = [
  { key: "7d", due: (a) => a.reason === "trial" && a.daysLeft != null && a.daysLeft <= 7 },
  { key: "3d", due: (a) => a.reason === "trial" && a.daysLeft != null && a.daysLeft <= 3 },
  { key: "1d", due: (a) => a.reason === "trial" && a.daysLeft != null && a.daysLeft <= 1 },
  { key: "ended", due: (a) => a.reason === "trialEnded" },
  { key: "readOnly", due: (a) => a.reason === "trialEnded" && a.level !== "grace" },
  { key: "locked", due: (a) => a.reason === "trialEnded" && a.level === "locked" },
];

/**
 * Which reminder to send today, or null.
 *
 * Only the furthest one that is due: a company whose trial was extended, or a
 * job that did not run for a week, hears where it stands now — not four
 * emails in one morning about stages it has already passed. Earlier ones are
 * not sent afterwards either.
 *
 * @param {object} access from companyAccess()
 * @param {string[]} sent keys already sent for this trial
 */
export function dueTrialReminder(access, sent = []) {
  if (!access || (access.reason !== "trial" && access.reason !== "trialEnded")) {
    return null;
  }
  const due = TRIAL_REMINDERS.filter((r) => r.due(access));
  const latest = due[due.length - 1];
  if (!latest || sent.includes(latest.key)) return null;
  // Already told about something later (the date was moved back, say): stay
  // quiet rather than step backwards.
  const latestIndex = TRIAL_REMINDERS.indexOf(latest);
  if (TRIAL_REMINDERS.slice(latestIndex + 1).some((r) => sent.includes(r.key))) {
    return null;
  }
  return latest.key;
}
