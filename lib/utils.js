import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export const calculateDuration = (start, end) => {
  if (!start || !end) return "00:00";

  const [startHours, startMinutes] = start.split(":").map(Number);
  const [endHours, endMinutes] = end.split(":").map(Number);

  let hours = endHours - startHours;
  let minutes = endMinutes - startMinutes;

  if (minutes < 0) {
    hours -= 1;
    minutes += 60;
  }

  if (hours < 0) {
    hours += 24;
  }

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}`;
};

export const convertTimeToDecimal = (timeStr) => {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours + minutes / 60;
};

export const calculateTotalPay = (durationStr, payRate) => {
  const decimalHours = convertTimeToDecimal(durationStr);
  const totalPay = decimalHours * payRate;
  return totalPay.toFixed(2); // rounded to 2 decimal places
};
