// Single source of truth for right-to-work (RTW) check state. Shared by the
// tables, the record-a-check dialog and the server action so they always agree.
//
// A right-to-work check is a point-in-time event, not a field on the employee:
// HR verifies the documents, and that verification only covers the visa that
// was valid on the day. When that visa expires — or is renewed / switched to a
// different category — the check is stale and a fresh one must be recorded.
// So we keep an append-only history and read "the latest check" from it.

import { daysUntil } from "@/lib/visaMilestones";

// How the documents were verified. Mirrors the Home Office routes HR actually
// uses; "Other" keeps the list from blocking an unusual case.
export const RTW_DOCUMENT_TYPES = [
  { label: "Online share code (Home Office)", value: "Share code" },
  { label: "eVisa / UKVI account", value: "eVisa" },
  { label: "Biometric residence permit (BRP)", value: "BRP" },
  { label: "Passport / national ID", value: "Passport" },
  { label: "Other document", value: "Other" },
];

// A recheck is prompted once the visa is inside this window, matching the visa
// reminder horizon so HR sees one story, not two.
export const RTW_RECHECK_WINDOW_DAYS = 90;

const toTime = (d) => {
  if (!d) return null;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

/**
 * The most recent check in a history array, by the date the check was carried
 * out (not the date it was typed in). Returns null for an empty history.
 */
export function getLatestRightToWorkCheck(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return null;
  return checks.reduce((latest, check) => {
    if (!check) return latest;
    const current = toTime(check.checkedAt) ?? 0;
    const best = latest ? (toTime(latest.checkedAt) ?? 0) : -Infinity;
    return current >= best ? check : latest;
  }, null);
}

/** History newest-first, for display. Does not mutate the input. */
export function sortRightToWorkChecks(checks) {
  if (!Array.isArray(checks)) return [];
  return [...checks].sort(
    (a, b) => (toTime(b?.checkedAt) ?? 0) - (toTime(a?.checkedAt) ?? 0),
  );
}

/**
 * Current right-to-work standing for one employee.
 *
 * @param {Object} p
 * @param {string} [p.immigrationType]  "British" means no check is needed
 * @param {Date|string|null} [p.visaEndDate]  Current visa expiry on the record
 * @param {Array} [p.checks]            The rightToWorkChecks history
 * @returns {{ level: string, label: string, detail: string, lastCheckedAt: Date|string|null,
 *             latest: Object|null, needsCheck: boolean }}
 */
export function getRightToWorkStatus({
  immigrationType,
  visaEndDate,
  checks,
} = {}) {
  const latest = getLatestRightToWorkCheck(checks);
  const lastCheckedAt = latest?.checkedAt || null;

  if (immigrationType === "British") {
    return {
      level: "not_required",
      label: "Not required",
      detail: "British national — no right-to-work expiry to track.",
      lastCheckedAt,
      latest,
      needsCheck: false,
    };
  }

  if (!latest) {
    return {
      level: "never",
      label: "Never checked",
      detail: "No right-to-work check has been recorded for this employee.",
      lastCheckedAt: null,
      latest: null,
      needsCheck: true,
    };
  }

  const days = daysUntil(visaEndDate);

  // The visa on file has run out, so whatever was verified no longer proves
  // anything. This outranks a stale snapshot — it is the harder failure.
  if (days !== null && days <= 0) {
    return {
      level: "expired",
      label: "Recheck required",
      detail: "The visa has expired — a new right-to-work check is required.",
      lastCheckedAt,
      latest,
      needsCheck: true,
    };
  }

  // The visa expiry moved since the check was recorded (renewal, switch, or a
  // correction), so the last check was made against a different permission.
  const checkedAgainst = toTime(latest.visaEndDate);
  const current = toTime(visaEndDate);
  if (checkedAgainst !== current) {
    return {
      level: "stale",
      label: "Recheck required",
      detail:
        "The visa details changed after the last check — record a new one.",
      lastCheckedAt,
      latest,
      needsCheck: true,
    };
  }

  if (days !== null && days <= RTW_RECHECK_WINDOW_DAYS) {
    return {
      level: "due_soon",
      label: "Recheck due",
      detail: `The visa expires in ${days} day${
        days === 1 ? "" : "s"
      } — a follow-up check will be needed once it is renewed.`,
      lastCheckedAt,
      latest,
      needsCheck: false,
    };
  }

  return {
    level: "valid",
    label: "Valid",
    detail: "The latest check covers the visa currently on file.",
    lastCheckedAt,
    latest,
    needsCheck: false,
  };
}

// Tailwind text colours per level, matching the visa traffic light.
export const RTW_STATUS_TEXT = {
  not_required: "text-neutral-500",
  never: "text-rose-600 font-semibold",
  expired: "text-rose-600 font-semibold",
  stale: "text-amber-600 font-medium",
  due_soon: "text-orange-500 font-medium",
  valid: "text-emerald-600",
};

// Badge variants for the same levels.
export const RTW_STATUS_BADGE = {
  not_required: "outline",
  never: "destructive",
  expired: "destructive",
  stale: "secondary",
  due_soon: "secondary",
  valid: "outline",
};
