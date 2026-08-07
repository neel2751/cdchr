"use server";

const BANK_HOLIDAY_URL = "https://www.gov.uk/bank-holidays.json";
const REGION = "england-and-wales";

/**
 * UK bank holidays for the current year onwards, from gov.uk.
 *
 * Fetched on the server rather than in the browser: the app's
 * Content-Security-Policy limits `connect-src` to our own origin and S3, so a
 * client-side fetch to gov.uk is blocked outright. Doing it here also lets the
 * response be cached and keeps the CSP tight.
 *
 * Cached for a day — the published list changes at most a few times a year.
 */
export async function getBankHolidays() {
  try {
    const res = await fetch(BANK_HOLIDAY_URL, {
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) {
      return {
        success: false,
        message: `Bank holiday service returned ${res.status}`,
      };
    }

    const payload = await res.json();
    const events = payload?.[REGION]?.events;
    if (!Array.isArray(events)) {
      return { success: false, message: "Unexpected bank holiday response" };
    }

    // Past years are of no use to a planner, so keep the current year onwards.
    const currentYear = new Date().getFullYear();
    const upcoming = events
      .filter((event) => {
        const year = Number(String(event?.date).slice(0, 4));
        return Number.isFinite(year) && year >= currentYear;
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return { success: true, data: JSON.stringify(upcoming) };
  } catch (error) {
    console.log("Error fetching bank holidays:", error?.message);
    return { success: false, message: "Could not load bank holidays" };
  }
}
