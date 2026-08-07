import { format } from "date-fns";

export function formatDates(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start.getFullYear() === end.getFullYear()) {
    return `${format(start, "MMM dd")} - ${format(end, "MMM dd, yyyy")}`;
  } else {
    return `${format(start, "MMM dd, yyyy")} - ${format(end, "MMM dd, yyyy")}`;
  }
}

export function normalizeDateToUTC(inputDate) {
  if (!inputDate) return null;
  const localDate = new Date(inputDate);
  const utcDate = new Date(
    Date.UTC(localDate.getFullYear(), localDate.getMonth(), localDate.getDate())
  );
  return utcDate;
}

export const formatToDateString = (date) => {
  return format(new Date(date), "yyyy-MM-dd");
};

export const formatToDateTimeString = (date) => {
  return format(new Date(date), "yyyy-MM-dd HH:mm:ss");
};

/**
 * Human-readable date for read-only profile views. Returns a placeholder rather
 * than throwing when the value is missing or unparseable, so a blank field on
 * an older record cannot break the page.
 */
export const formatDisplayDate = (date, fallback = "-") => {
  if (!date) return fallback;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return format(parsed, "PPP");
};

export const formatTime = (date) => {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};
