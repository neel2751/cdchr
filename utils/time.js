export function getUKTime({ format = "HH:mm", asDateObject = false }) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());

  const dateParts = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  const dateInUK = new Date(
    `${dateParts.year}-${dateParts.month}-${dateParts.day}T${dateParts.hour}:${dateParts.minute}:${dateParts.second}`
  );

  if (asDateObject) return dateInUK;

  if (format === "iso") return dateInUK.toISOString();

  if (format === "full") {
    return dateInUK.toLocaleString("en-GB", {
      timeZone: "Europe/London",
    });
  }

  // Default: HH:mm
  return `${dateParts.hour}:${dateParts.minute}`;
}

export const formatCurrency = (value, currency = "GBP") => {
  if (value === "NaN") return "£0.00";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(value);
};
