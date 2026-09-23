/**
 * What counts as a valid shift, and what a company chooses to enforce on top.
 *
 * Two different kinds of rule live here and they are treated differently:
 *
 *   CORRECTNESS — a record that breaks one of these is not a policy breach,
 *   it is nonsense: a break that ends before it starts, two breaks claiming
 *   the same half hour, a clock-out dated next Tuesday. These are always on.
 *   Nothing enforced them before, on the scanner or in the admin editor, so
 *   the database can hold all of the above today.
 *
 *   POLICY — "no break in the first two hours", "at least thirty minutes",
 *   "two hours before you can clock out". These were already written into the
 *   scanner as constants, but the comparison behind them was string
 *   subtraction, so every one evaluated NaN and passed. They have therefore
 *   never applied to anybody, and switching them on would start rejecting
 *   scans that worked yesterday. So they are company settings that default to
 *   off — exactly the behaviour every company has now — and a company that
 *   wants them turns them on for itself. Same reasoning as
 *   `observesBankHolidays` in models/workSettingModel.js.
 */
import { diffMinutes, isClockTime, toMinutes } from "@/lib/clockTime";

/**
 * The longest a single shift may be, in hours.
 *
 * This is the one correctness rule with a judgement in it, because an end
 * before the start is ambiguous: 22:00 to 06:00 is a night shift, and 09:00 to
 * 08:00 is a mistyped 18:00. Both wrap midnight; only the length tells them
 * apart. 16 hours admits any real shift — including a long night — while still
 * catching the typo, which lands at 23.
 */
export const DEFAULT_MAX_SHIFT_HOURS = 16;

/** Policy rules off, matching what every company effectively has today. */
export const DEFAULT_CLOCK_RULES = {
  maxShiftHours: DEFAULT_MAX_SHIFT_HOURS,
  minMinutesBeforeBreak: 0,
  minBreakMinutes: 0,
  minMinutesBeforeClockOut: 0,
  clockCutoverDate: null,
};

/**
 * The cutover as a UTC midnight, or null for "no floor".
 *
 * Normalised to the start of its day because clock records are stored at UTC
 * midnight: a cutover carrying a time of day would compare unevenly against
 * them and drop the cutover day itself for some companies and not others.
 *
 * An unparseable value becomes null rather than throwing or becoming an epoch
 * date — no floor is the safe reading, since it flags more rather than fewer.
 */
export function resolveCutover(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** Read the rules off a settings document, filling in anything absent. */
export function resolveClockRules(settings) {
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    maxShiftHours: num(settings?.maxShiftHours, DEFAULT_MAX_SHIFT_HOURS) || DEFAULT_MAX_SHIFT_HOURS,
    minMinutesBeforeBreak: num(settings?.minMinutesBeforeBreak, 0),
    minBreakMinutes: num(settings?.minBreakMinutes, 0),
    minMinutesBeforeClockOut: num(settings?.minMinutesBeforeClockOut, 0),
    clockCutoverDate: resolveCutover(settings?.clockCutoverDate),
  };
}

/** "90 minutes" reads worse than "1h 30m" in a message someone has to act on. */
export function describeMinutes(total) {
  const minutes = Math.max(0, Math.round(total));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} minute${m === 1 ? "" : "s"}`;
  if (!m) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h}h ${m}m`;
}

/**
 * Where a break sits relative to the shift, in minutes from clock-in.
 *
 * Everything is measured from clock-in rather than from midnight so that a
 * shift crossing midnight compares correctly: a break at 00:30 on a shift that
 * started at 22:00 is 150 minutes in, not 1290 minutes before.
 */
function breakWindow(clockIn, br) {
  const start = diffMinutes(clockIn, br?.breakIn);
  const end = br?.breakOut ? diffMinutes(clockIn, br.breakOut) : null;
  return { start, end };
}

/**
 * Is this whole shift internally consistent?
 *
 * Returns `{ ok, errors }` with every problem found rather than the first, so
 * an admin fixing a row is told all of it at once.
 *
 * @param shift   { clockIn, clockOut, breaks[] } — the times as stored
 * @param context { date, now, today } — the record's working day, the current
 *                UK clock time, and today's working day. Times are only
 *                checked against the clock when the record is for today;
 *                editing last Tuesday, any time that day is legitimate.
 */
export function validateShift(shift, context = {}, rules = DEFAULT_CLOCK_RULES) {
  const errors = [];
  const { clockIn, clockOut } = shift || {};
  const breaks = Array.isArray(shift?.breaks) ? shift.breaks : [];
  const { date, now, today } = context;

  for (const [label, value] of [
    ["Clock in", clockIn],
    ["Clock out", clockOut],
  ]) {
    if (value != null && value !== "" && !isClockTime(value)) {
      errors.push(`${label} must be a time like 09:30`);
    }
  }

  if (clockOut && !clockIn) {
    errors.push("A clock out needs a clock in");
  }

  // A record dated in the future cannot describe work that has happened.
  if (date && today && date.getTime() > today.getTime()) {
    errors.push("Attendance cannot be recorded for a future date");
  }

  const isToday = date && today && date.getTime() === today.getTime();
  const nowMinutes = isClockTime(now) ? toMinutes(now) : null;

  // Only meaningful on today's record: on any earlier day the whole day has
  // already happened.
  //
  // Clock-in only. A clock-out cannot be compared this way, because a shift
  // that wraps past midnight ends at a time that legitimately reads as earlier
  // than now — 06:00 against a current 18:00 is a finished night shift, not a
  // time that has yet to happen. The length cap is what bounds the clock-out.
  if (isToday && nowMinutes !== null) {
    const startedAt = toMinutes(clockIn);
    if (startedAt !== null && startedAt > nowMinutes) {
      errors.push(`Clock in cannot be later than the current time (${now})`);
    }
  }

  const shiftLength =
    clockIn && clockOut ? diffMinutes(clockIn, clockOut) : null;

  if (shiftLength !== null) {
    const maxMinutes = rules.maxShiftHours * 60;
    if (shiftLength > maxMinutes) {
      // Worded around the likely cause. A wrapped shift this long is nearly
      // always a clock-out typed with the wrong half of the day.
      errors.push(
        `That is a ${describeMinutes(shiftLength)} shift, longer than the ` +
          `${rules.maxShiftHours}-hour maximum. Check the clock out time.`,
      );
    }
  }

  // Breaks: each one well-formed, inside the shift, and not overlapping the
  // one before it.
  const windows = [];
  breaks.forEach((br, i) => {
    const n = i + 1;
    const hasIn = br?.breakIn != null && br.breakIn !== "";
    const hasOut = br?.breakOut != null && br.breakOut !== "";

    if (hasIn && !isClockTime(br.breakIn)) {
      errors.push(`Break ${n}: start must be a time like 12:00`);
      return;
    }
    if (hasOut && !isClockTime(br.breakOut)) {
      errors.push(`Break ${n}: end must be a time like 12:30`);
      return;
    }
    if (hasOut && !hasIn) {
      errors.push(`Break ${n} has an end but no start`);
      return;
    }
    if (!hasIn) return;

    if (!clockIn) {
      errors.push(`Break ${n} needs a clock in first`);
      return;
    }

    const { start, end } = breakWindow(clockIn, br);

    if (end !== null && end < start) {
      errors.push(`Break ${n}: end cannot be before its start`);
      return;
    }

    // A break that starts and ends in the same minute is allowed. Times are
    // stored to the minute, so "started and finished inside one minute" is
    // what a mis-click looks like AND what a genuinely brief break looks
    // like — and rejecting it left the record stuck showing On Break with no
    // way to close it short of editing the times by hand. It costs nothing:
    // zero minutes are deducted. The scanner has always allowed it; this is
    // the admin path agreeing with it.

    // "Inside the shift" is only checkable once the shift has an end.
    if (shiftLength !== null) {
      if (start > shiftLength || (end !== null && end > shiftLength)) {
        errors.push(`Break ${n} falls outside the shift`);
        return;
      }
    }

    windows.push({ n, start, end: end ?? start });
  });

  const ordered = [...windows].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (cur.start < prev.end) {
      errors.push(`Breaks ${prev.n} and ${cur.n} overlap`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * May this scan happen right now?
 *
 * The live-scan counterpart to validateShift: one action against the record as
 * it stands. Returns `{ ok, message }` — the message is shown to the employee
 * at the scanner, so it says what to do rather than what was wrong.
 *
 * @param record the current clock record, or null before the first scan
 * @param action "clockIn" | "breakIn" | "breakOut" | "clockOut"
 * @param now    the UK clock time of the scan
 */
export function checkClockAction(record, action, now, rules = DEFAULT_CLOCK_RULES) {
  const deny = (message) => ({ ok: false, message });
  const allow = { ok: true, message: null };

  if (!isClockTime(now)) return deny("Could not read the current time");

  const breaks = Array.isArray(record?.breaks) ? record.breaks : [];
  const openBreak = [...breaks].reverse().find((b) => b?.breakIn && !b?.breakOut);

  if (action === "clockIn") {
    if (!record) return allow;
    return deny(
      record.clockOut
        ? "You have already clocked out today."
        : "You are already clocked in.",
    );
  }

  if (!record) return deny("You must clock in first.");
  if (!record.clockIn) return deny("You must clock in first.");
  if (record.clockOut) return deny("You have already clocked out today.");

  const sinceClockIn = diffMinutes(record.clockIn, now);

  if (action === "breakIn") {
    if (openBreak) return deny("You must break out first.");
    if (
      rules.minMinutesBeforeBreak > 0 &&
      sinceClockIn !== null &&
      sinceClockIn < rules.minMinutesBeforeBreak
    ) {
      return deny(
        `You cannot take a break within ` +
          `${describeMinutes(rules.minMinutesBeforeBreak)} of clocking in.`,
      );
    }
    return allow;
  }

  if (action === "breakOut") {
    if (!openBreak) return deny("You must break in first.");
    const taken = diffMinutes(openBreak.breakIn, now);
    if (
      rules.minBreakMinutes > 0 &&
      taken !== null &&
      taken < rules.minBreakMinutes
    ) {
      return deny(
        `A break must be at least ${describeMinutes(rules.minBreakMinutes)}.`,
      );
    }
    return allow;
  }

  if (action === "clockOut") {
    // An open break at clock-out is closed by the caller rather than refused:
    // someone who forgets to break back in should not be stuck at the scanner
    // unable to go home.
    if (
      rules.minMinutesBeforeClockOut > 0 &&
      sinceClockIn !== null &&
      sinceClockIn < rules.minMinutesBeforeClockOut
    ) {
      return deny(
        `You must be clocked in for at least ` +
          `${describeMinutes(rules.minMinutesBeforeClockOut)} before clocking out.`,
      );
    }
    const length = diffMinutes(record.clockIn, now);
    if (length !== null && length > rules.maxShiftHours * 60) {
      return deny(
        `That would be a ${describeMinutes(length)} shift. Ask your manager ` +
          `to close it off — it looks like a missed clock out.`,
      );
    }
    return allow;
  }

  return deny("Unknown action.");
}
