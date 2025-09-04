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

// Function to get the starting year of the current leave year
export function getCurrentLeaveYearStart() {
  const today = new Date();
  const month = today.getMonth(); // 0 = Jan, 11 = Dec
  const year = today.getFullYear();

  // Assuming leave year runs from April to March
  return month >= 3 ? year : year - 1;
}

// Function to get leave year string like "2025-26"
export function getLeaveYearStringFilter(startYear) {
  const endYear = (startYear + 1) % 100; // last two digits
  return `${startYear}-${endYear.toString().padStart(2, "0")}`;
}
