// Single source of truth for visa-expiry reminder milestones. Used by the UI,
// the manual send action, and the automated cron job so they always agree.

export const MILESTONES = [
  { key: "3_months", days: 90, label: "3 months" },
  { key: "1_month", days: 30, label: "1 month" },
  { key: "7_days", days: 7, label: "7 days" },
  { key: "3_days", days: 3, label: "3 days" },
];

export const MILESTONE_WINDOW_DAYS = 90;

/**
 * Whole days from now until the given date (negative if already past).
 */
export function daysUntil(date) {
  if (!date) return null;
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTarget = new Date(target);
  startOfTarget.setHours(0, 0, 0, 0);
  return Math.round((startOfTarget - startOfToday) / MS_PER_DAY);
}

/**
 * The current applicable reminder bucket for a given days-remaining value.
 * Returns "expired" when the visa has already passed, a milestone key when
 * within the 90-day window, or null when there is nothing to send yet.
 */
export function getMilestone(days) {
  if (days === null || days === undefined) return null;
  if (days <= 0) return "expired";
  // smallest threshold the value falls into (e.g. 25 days -> "1_month")
  let current = null;
  for (const m of MILESTONES) {
    if (days <= m.days) current = m.key;
  }
  return current; // null when days > 90
}

export function milestoneLabel(key) {
  if (key === "expired") return "Expired";
  return MILESTONES.find((m) => m.key === key)?.label || key;
}
