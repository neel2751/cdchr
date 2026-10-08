/**
 * One vocabulary for "where is this person up to today".
 *
 * There were five writers and they had each invented their own words:
 * the scanner wrote "completed", the admin quick-actions wrote "checked-out"
 * and "break-ended", the legacy site path wrote "break-in"/"break-out", and
 * the attendance table's badge map understood none of them — it recognised
 * "clocked-out" and fell through to "Not Clocked In" for everything else. The
 * table only looked right because it ignored the stored value entirely and
 * re-derived the status from clockIn/clockOut/breaks on every render.
 *
 * So deriving is the real behaviour, and this makes it the only behaviour.
 * `status` becomes a cache of the record's own fields rather than a parallel
 * truth that drifts: nothing takes it from a caller, and every write recomputes
 * it from what is actually stored.
 */

export const CLOCK_STATUS = {
  CHECKED_IN: "checked-in",
  ON_BREAK: "on-break",
  CLOCKED_OUT: "clocked-out",
};

/** Every value the field is allowed to hold. Used as the schema enum. */
export const CLOCK_STATUSES = Object.values(CLOCK_STATUS);

/**
 * The words five different writers used for these three states, mapped back.
 * Only needed by the migration and by any record written before this existed.
 */
const LEGACY_ALIASES = {
  "checked-out": CLOCK_STATUS.CLOCKED_OUT,
  completed: CLOCK_STATUS.CLOCKED_OUT,
  "clocked-out": CLOCK_STATUS.CLOCKED_OUT,
  "break-in": CLOCK_STATUS.ON_BREAK,
  "on-break": CLOCK_STATUS.ON_BREAK,
  "break-out": CLOCK_STATUS.CHECKED_IN,
  "break-ended": CLOCK_STATUS.CHECKED_IN,
  "checked-in": CLOCK_STATUS.CHECKED_IN,
};

/** Translate an old status word, or null if it is not one we know. */
export function normaliseClockStatus(value) {
  if (typeof value !== "string") return null;
  return LEGACY_ALIASES[value.trim()] || null;
}

/**
 * What a record's status *is*, read off the record.
 *
 * Clocked out wins over an unclosed break: a shift that ended is over
 * regardless of what the breaks say, and a record can carry a break left open
 * by someone who forgot to break back in.
 *
 * Returns null for a record with no clock-in — that is not a state this
 * vocabulary describes. Whether such a person is absent, on leave or on a bank
 * holiday is a question about the day, not about the record, and the
 * attendance table answers it with information this does not have.
 */
export function deriveClockStatus(record) {
  if (!record?.clockIn) return null;
  if (record.clockOut) return CLOCK_STATUS.CLOCKED_OUT;

  const breaks = Array.isArray(record.breaks) ? record.breaks : [];
  const onBreak = breaks.some((b) => b?.breakIn && !b?.breakOut);
  return onBreak ? CLOCK_STATUS.ON_BREAK : CLOCK_STATUS.CHECKED_IN;
}
