/**
 * Clock times are recorded as the wall-clock time where the work happens.
 *
 * A clock record keeps "HH:mm" strings, and every hours, break, overtime and
 * lateness calculation does arithmetic on those strings. So the string has to
 * be the time on the clock at the site or office — 09:00 in Dhaka is 09:00,
 * not the 03:00 it reads in London — and the record carries the zone it was
 * taken in so it can be told apart from a UK one.
 *
 * Records written before zones existed have no `timeZone`. They were all taken
 * in UK time, so a missing zone means `Europe/London`, and they are never
 * shifted.
 *
 * Zones are IANA names, never fixed offsets: "Europe/London" knows about BST,
 * "+01:00" does not.
 */

export const DEFAULT_TIME_ZONE = "Europe/London";

export const TIME_ZONE_OPTIONS = [
  { value: "Europe/London", label: "United Kingdom (London)" },
  { value: "Europe/Dublin", label: "Ireland (Dublin)" },
  { value: "Europe/Paris", label: "France (Paris)" },
  { value: "Europe/Berlin", label: "Germany (Berlin)" },
  { value: "Europe/Madrid", label: "Spain (Madrid)" },
  { value: "Europe/Warsaw", label: "Poland (Warsaw)" },
  { value: "Europe/Bucharest", label: "Romania (Bucharest)" },
  { value: "Asia/Dhaka", label: "Bangladesh (Dhaka)" },
  { value: "Asia/Kolkata", label: "India (Kolkata)" },
  { value: "Asia/Karachi", label: "Pakistan (Karachi)" },
  { value: "Asia/Kathmandu", label: "Nepal (Kathmandu)" },
  { value: "Asia/Colombo", label: "Sri Lanka (Colombo)" },
  { value: "Asia/Dubai", label: "United Arab Emirates (Dubai)" },
  { value: "Asia/Riyadh", label: "Saudi Arabia (Riyadh)" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Kuala_Lumpur", label: "Malaysia (Kuala Lumpur)" },
  { value: "Asia/Manila", label: "Philippines (Manila)" },
  { value: "Asia/Hong_Kong", label: "Hong Kong" },
  { value: "Asia/Shanghai", label: "China (Shanghai)" },
  { value: "Asia/Tokyo", label: "Japan (Tokyo)" },
  { value: "Africa/Lagos", label: "Nigeria (Lagos)" },
  { value: "Africa/Nairobi", label: "Kenya (Nairobi)" },
  { value: "Africa/Johannesburg", label: "South Africa (Johannesburg)" },
  { value: "America/New_York", label: "United States (New York)" },
  { value: "America/Chicago", label: "United States (Chicago)" },
  { value: "America/Los_Angeles", label: "United States (Los Angeles)" },
  { value: "America/Toronto", label: "Canada (Toronto)" },
  { value: "Australia/Sydney", label: "Australia (Sydney)" },
];

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The date and wall-clock time in `timeZone` at `now`.
 *
 * Built from the formatter's parts directly. Parsing them back through
 * `new Date("YYYY-MM-DDTHH:mm")` reads them in the server's own zone, which
 * moves the date whenever the server is not on UTC.
 */
export function getZonedNow(timeZone = DEFAULT_TIME_ZONE, now = new Date()) {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      // h23, not hour12:false — the latter can render midnight as "24:00",
      // which the clock models' HH:mm pattern rejects.
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    instant: now,
    timeZone: zone,
  };
}

/**
 * The HH:mm to stamp at `instant` onto `record`, or onto a new record opened
 * in `zoneIfNew`. A record keeps the zone it was opened in, so a clock out
 * lands in the same zone as its clock in — and a record from before zones
 * existed carries on in UK time.
 */
export function timeForRecord(record, { instant, timeZone: zoneIfNew }) {
  const zone = record ? record.timeZone || DEFAULT_TIME_ZONE : zoneIfNew;
  return getZonedNow(zone, instant).time;
}

/**
 * A short place name for showing beside a time, or null for UK time — which
 * is what every unlabelled time in the app already means.
 */
export function timeZoneLabel(timeZone) {
  if (!timeZone || timeZone === DEFAULT_TIME_ZONE) return null;
  const option = TIME_ZONE_OPTIONS.find((o) => o.value === timeZone);
  const match = option?.label.match(/\(([^)]+)\)/);
  if (match) return match[1];
  if (option) return option.label;
  return timeZone.split("/").pop().replace(/_/g, " ");
}
