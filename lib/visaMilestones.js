// Single source of truth for visa-expiry reminder milestones. Used by the UI,
// the manual send action, and the automated cron job so they always agree.

import { intervalToDuration } from "date-fns";

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

/**
 * Precise, human-readable time left until a visa expires, e.g.
 * "1 year 3 months 5 days". Zero units are omitted. Returns:
 *   - null                when there is no / an invalid date
 *   - "Expired"           when the date has already passed
 *   - "Less than a day"   when under 24 hours remain
 */
export function formatVisaRemaining(date) {
  if (!date) return null;
  const end = new Date(date);
  if (Number.isNaN(end.getTime())) return null;
  const now = new Date();
  if (end <= now) return "Expired";

  const dur = intervalToDuration({ start: now, end });
  const parts = [];
  if (dur.years) parts.push(`${dur.years} year${dur.years > 1 ? "s" : ""}`);
  if (dur.months) parts.push(`${dur.months} month${dur.months > 1 ? "s" : ""}`);
  if (dur.days) parts.push(`${dur.days} day${dur.days > 1 ? "s" : ""}`);
  return parts.length ? parts.join(" ") : "Less than a day";
}

/**
 * Traffic-light urgency for a visa end date, based on days remaining:
 *   expired  (already past)      -> red
 *   critical (<= 7 days)         -> red
 *   warning  (<= 30 days / 1 mo) -> amber
 *   soon     (<= 90 days / 3 mo) -> orange
 *   safe     (> 90 days)         -> green
 * Returns null when there is no date (e.g. British / no-visa staff).
 */
export function getVisaUrgencyLevel(date) {
  const days = daysUntil(date);
  if (days === null) return null;
  if (days <= 0) return "expired";
  if (days <= 7) return "critical";
  if (days <= 30) return "warning";
  if (days <= 90) return "soon";
  return "safe";
}

// Tailwind text-colour classes for each urgency level (traffic light).
export const VISA_URGENCY_TEXT = {
  expired: "text-rose-600 font-semibold",
  critical: "text-rose-600 font-semibold",
  warning: "text-amber-600 font-medium",
  soon: "text-orange-500 font-medium",
  safe: "text-emerald-600",
};
