import { addDays } from "date-fns";

export function getLeaveYearString(date = new Date(), short = true) {
  const year =
    date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  const nextYear = year + 1;

  return short ? `${year}-${String(nextYear).slice(2)}` : `${year}-${nextYear}`;
}

export function getLeaveYearsFromRange(startDate, endDate) {
  const years = new Set();
  let current = new Date(startDate);
  const newEndDate = new Date(endDate);

  while (current <= newEndDate) {
    years.add(getLeaveYearString(current));
    current = addDays(current, 1);
  }
  return Array.from(years);
}
