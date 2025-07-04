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

export const formatTime = (date) => {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};
