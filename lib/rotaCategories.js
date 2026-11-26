/**
 * Rota categories — the choices on a weekly rota for each day ("Office",
 * "Off", "Teaching a class"…) — and the rule each one follows.
 *
 * They used to be bare words with meaning wired into the screens: "OFF" meant
 * no hours, "OFFICE/SITE" meant pick a site, and anything else meant hours.
 * A tuition centre could not have "Teaching a class" behave like
 * "OFFICE/SITE" without being called that. Now each category says what it
 * means, and the screens ask that:
 *
 *   off    not working — no hours
 *   work   working — start and end times
 *   place  working at one of the company's sites / branches / classes (its
 *          words, data/terminology.js) — times and which one
 *
 * A category also carries default hours, filled in when it is chosen.
 *
 * Every rota day stores the category's `value` — the key, which never changes
 * once used — and, from now on, its `kind` and `label` as they were when the
 * rota was saved (server/weeklyRotaServer). So a rota reads the same after a
 * category is renamed, and old rotas with neither still read right through
 * entryKind() below.
 */

export const ROTA_KINDS = ["work", "place", "off"];

/** The kind a category, or a saved rota day, has. */
export function entryKind(entry) {
  if (!entry) return null;
  if (ROTA_KINDS.includes(entry.kind)) return entry.kind;
  // Saved before categories had rules: the old fixed words.
  const value = entry.category ?? entry.value ?? entry.attendanceCategoryValue;
  if (value === "OFF" || value === "Holiday") return "off";
  if (value === "OFFICE/SITE") return "place";
  return value ? "work" : null;
}

export const isOff = (entry) => entryKind(entry) === "off";
export const needsPlace = (entry) => entryKind(entry) === "place";

/** What a rota day says, for a table cell or an export. */
export function describeEntry(entry) {
  if (!entry?.category) return "";
  if (isOff(entry)) return entry.category === "Holiday" ? "Holiday" : entry.label || "Off";
  const name = entry.label || entry.category;
  const times = entry.startTime && entry.endTime ? ` (${entry.startTime}–${entry.endTime})` : "";
  return `${name}${needsPlace(entry) && entry.site ? ` - ${entry.site}` : ""}${times}`;
}

/** Colours for the employee's own rota view, by kind. */
export function kindColour(entry) {
  switch (entryKind(entry)) {
    case "off":
      return "bg-red-100 border-red-300 text-red-800 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200";
    case "place":
      return "bg-green-100 border-green-300 text-green-800 dark:bg-green-950/40 dark:border-green-900 dark:text-green-200";
    case "work":
      return "bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-950/40 dark:border-indigo-900 dark:text-indigo-200";
    default:
      return "bg-gray-100 border-gray-300 text-gray-800";
  }
}

/**
 * The categories a new company starts with, in its own words. The values are
 * the old fixed ones, so a company's earlier rotas and these agree.
 *
 * @param {object} terms the company's words (data/terminology.js)
 */
export function starterRotaCategories(terms = {}) {
  const place = (terms.site || "Site").toLowerCase();
  return [
    { name: "Office", value: "OFFICE", kind: "work", startTime: "09:00", endTime: "17:00", description: "Working at the office" },
    {
      name: `Office / ${terms.site || "Site"}`,
      value: "OFFICE/SITE",
      kind: "place",
      startTime: "09:00",
      endTime: "17:00",
      description: `Working at a ${place} — choose which one`,
    },
    { name: "Off", value: "OFF", kind: "off", description: "Not working" },
  ];
}

/** A key for a new category from its name: "Work from home" → "WORK FROM HOME". */
export function categoryValueFor(name) {
  return String(name || "").trim().toUpperCase().replace(/\s+/g, " ").slice(0, 40);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (t) => TIME.test(String(t || ""));
