/**
 * What the policy screens and the policy server both need to agree on.
 *
 * Kept out of server/policyServer: those files carry "use server", which only
 * permits async function exports, and the browser needs these lists too.
 */

/**
 * The shelves every company starts with. Created the first time the library
 * is opened; after that they are the company's own to rename or archive.
 */
export const DEFAULT_POLICY_CATEGORIES = [
  {
    name: "HR",
    description: "Conduct, leave, grievance, disciplinary and equality.",
  },
  {
    name: "IT",
    description: "Acceptable use, passwords, devices and remote working.",
  },
  {
    name: "Finance",
    description: "Expenses, purchasing, approvals and anti-bribery.",
  },
  {
    name: "Health & Safety",
    description: "Risk assessments, first aid, accident reporting and PPE.",
  },
  {
    name: "Fire Safety",
    description: "Evacuation, fire wardens, alarms and assembly points.",
  },
  {
    name: "Data Protection",
    description: "GDPR, data retention, subject access and breaches.",
  },
];

/**
 * Files a policy may be.
 *
 * A policy is something people read, so: documents and the images a scanned
 * one arrives as. Nothing executable, and no archives — a zip is a way to
 * publish something nobody has looked inside.
 */
export const POLICY_FILE_TYPES = {
  "application/pdf": "PDF",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "Word",
  "image/png": "Image",
  "image/jpeg": "Image",
};

/** The `accept` attribute for the upload input, from the same list. */
export const POLICY_FILE_ACCEPT = Object.keys(POLICY_FILE_TYPES).join(",");

/**
 * Policy files go straight from the browser to storage, so this is not bound
 * by the 1 MB server-action body limit. 25 MB is a long handbook as a PDF; a
 * file larger than that is usually a scan at a resolution nobody needs.
 */
export const POLICY_MAX_BYTES = 25 * 1024 * 1024;

/** A category name folded for comparison: "Fire  safety " = "fire safety". */
export function policyNameKey(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** "2.4 MB", for the upload dialog and the version list. */
export function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------------ *
 * Reviews
 *
 * Dates here are working days: UTC midnight of a UK calendar day, the same
 * shape lib/clockTime.js stores clock records in. Arithmetic is done on the
 * UTC fields only, so the server's own timezone cannot move a review a day.
 * ------------------------------------------------------------------------ */

/** How often a policy can be set to come up for review, in months. */
export const REVIEW_INTERVAL_OPTIONS = [3, 6, 12, 24, 36];

/** A new policy is reviewed yearly unless someone says otherwise. */
export const DEFAULT_REVIEW_INTERVAL_MONTHS = 12;

/** The first reminder goes out this many days before a review is due. */
export const REVIEW_WARNING_DAYS = 30;

const DAY_MS = 86400000;

/**
 * `months` after a working day, clamped to the end of the month.
 *
 * Plain Date arithmetic overflows: 31 January plus one month is 3 March. A
 * policy last reviewed on the 31st is next due on the last day of the month,
 * not early in the one after it.
 */
export function addMonthsToDay(day, months) {
  const d = new Date(day);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + Number(months);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay)));
}

/** Whole days from one working day to another; negative when `to` is earlier. */
export function daysBetween(from, to) {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS);
}

/**
 * Which reminder a review this many days away is owed.
 *
 * Bands rather than exact days, so a run the scheduler missed — a deploy at
 * 09:00, a server restart — sends on the next day instead of never:
 *
 *   30 to 8 days    "30_days"
 *   7 to 1 days     "7_days"
 *   0 to -6 days    "due"         the due date, or the week after it
 *   -7 and beyond   "overdue_<n>" one per whole week overdue
 *
 * Each band is sent at most once per due date (see policyReviewJob.js), so
 * an overdue review produces one reminder a week until somebody acts on it.
 *
 * @returns {string|null} null when nothing is owed yet
 */
export function reviewMilestone(daysUntilDue) {
  if (daysUntilDue === null || daysUntilDue === undefined) return null;
  if (daysUntilDue > REVIEW_WARNING_DAYS) return null;
  if (daysUntilDue > 7) return "30_days";
  if (daysUntilDue > 0) return "7_days";
  const weeksOverdue = Math.floor(-daysUntilDue / 7);
  return weeksOverdue === 0 ? "due" : `overdue_${weeksOverdue}`;
}

/** "Overdue by 3 days", "Due today", "Due in 12 days" — for badges and emails. */
export function describeReviewDue(daysUntilDue) {
  if (daysUntilDue === null || daysUntilDue === undefined) return "";
  if (daysUntilDue < 0) {
    const n = -daysUntilDue;
    return `Overdue by ${n} ${n === 1 ? "day" : "days"}`;
  }
  if (daysUntilDue === 0) return "Due today";
  return `Due in ${daysUntilDue} ${daysUntilDue === 1 ? "day" : "days"}`;
}

/** "overdue" | "soon" | "ok" — how loudly the screens should say it. */
export function reviewUrgency(daysUntilDue) {
  if (daysUntilDue === null || daysUntilDue === undefined) return "ok";
  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue <= REVIEW_WARNING_DAYS) return "soon";
  return "ok";
}
