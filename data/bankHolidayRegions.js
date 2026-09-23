/**
 * The three bank holiday lists gov.uk publishes.
 *
 * They are not interchangeable, which is the whole reason a company picks one:
 *
 *   England and Wales  the default, and the only list this app used before
 *   Scotland           takes 2 January and St Andrew's Day; does NOT take
 *                      Easter Monday
 *   Northern Ireland   adds St Patrick's Day and the Twelfth
 *
 * A company on the wrong list is told to work days its office is shut and is
 * charged annual leave for days it should get free.
 *
 * Lives here rather than in server/holidayServer/holidayServer.js because that
 * file is `"use server"` — every export from one of those has to be an async
 * function, so a plain constant could not live there and still be importable by
 * the settings form.
 */
export const BANK_HOLIDAY_REGIONS = [
  { value: "england-and-wales", label: "England and Wales" },
  { value: "scotland", label: "Scotland" },
  { value: "northern-ireland", label: "Northern Ireland" },
];

export const DEFAULT_BANK_HOLIDAY_REGION = "england-and-wales";

/** The gov.uk division key for a stored setting, falling back when unknown. */
export function resolveRegion(region) {
  return BANK_HOLIDAY_REGIONS.some((r) => r.value === region)
    ? region
    : DEFAULT_BANK_HOLIDAY_REGION;
}
