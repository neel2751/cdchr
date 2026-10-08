/**
 * A colour per leave type, for the planner.
 *
 * The planner used three hardcoded cases — Annual green, Unpaid amber,
 * everything else purple — which was fine when a company had three leave types
 * and is not now: the starter catalogue alone has eleven, so sick, maternity,
 * bereavement, jury service and study leave all arrived as the same purple and
 * a day with four different absences read as one kind of absence.
 *
 * The named types get a deliberate colour (sick is not the same news as a
 * holiday). Anything a company invented falls through to a stable hash of the
 * name, so it keeps the same colour between months and between sessions rather
 * than depending on what order the day's leave happened to come back in.
 *
 * Tailwind cannot see a class name built at runtime, so every one of these is
 * written out in full.
 */

const NAMED = {
  "Annual Leave": {
    chip: "bg-emerald-50 text-emerald-900 border-emerald-500",
    dot: "bg-emerald-500",
  },
  "Unpaid Leave": {
    chip: "bg-amber-50 text-amber-900 border-amber-500",
    dot: "bg-amber-500",
  },
  "Sick Leave": {
    chip: "bg-rose-50 text-rose-900 border-rose-500",
    dot: "bg-rose-500",
  },
  "Maternity Leave": {
    chip: "bg-pink-50 text-pink-900 border-pink-500",
    dot: "bg-pink-500",
  },
  "Paternity Leave": {
    chip: "bg-fuchsia-50 text-fuchsia-900 border-fuchsia-500",
    dot: "bg-fuchsia-500",
  },
  "Adoption Leave": {
    chip: "bg-fuchsia-50 text-fuchsia-900 border-fuchsia-500",
    dot: "bg-fuchsia-500",
  },
  "Bereavement Leave": {
    chip: "bg-slate-100 text-slate-900 border-slate-500",
    dot: "bg-slate-500",
  },
  "Compassionate Leave": {
    chip: "bg-slate-100 text-slate-900 border-slate-500",
    dot: "bg-slate-500",
  },
  "Parental Leave": {
    chip: "bg-violet-50 text-violet-900 border-violet-500",
    dot: "bg-violet-500",
  },
  "Jury Service": {
    chip: "bg-cyan-50 text-cyan-900 border-cyan-500",
    dot: "bg-cyan-500",
  },
  "Study Leave": {
    chip: "bg-indigo-50 text-indigo-900 border-indigo-500",
    dot: "bg-indigo-500",
  },
};

/** The fallback palette, for leave types a company made up. */
const EXTRA = [
  { chip: "bg-teal-50 text-teal-900 border-teal-500", dot: "bg-teal-500" },
  { chip: "bg-sky-50 text-sky-900 border-sky-500", dot: "bg-sky-500" },
  { chip: "bg-lime-50 text-lime-900 border-lime-500", dot: "bg-lime-500" },
  { chip: "bg-orange-50 text-orange-900 border-orange-500", dot: "bg-orange-500" },
  { chip: "bg-purple-50 text-purple-900 border-purple-500", dot: "bg-purple-500" },
];

/** Stable across renders and sessions, because it is derived from the name. */
export function leaveTone(leaveType) {
  if (NAMED[leaveType]) return NAMED[leaveType];

  let hash = 0;
  for (const character of String(leaveType || "")) {
    hash = (hash * 31 + character.charCodeAt(0)) % 100000;
  }
  return EXTRA[hash % EXTRA.length];
}
