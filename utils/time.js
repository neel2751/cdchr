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
  if (format === "date") {
    return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  }
  if (format === "time") {
    return `${dateParts.hour}:${dateParts.minute}`;
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

export const formatDate = (date, formatStr = "dd/MM/yyyy") => {
  if (!date) return "";
  // return new Intl.DateTimeFormat("en-GB", {
  //   day: "2-digit",
  //   month: "2-digit",
  //   year: "numeric",
  // }).format(new Date(date));
  const options = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  };
  if (formatStr === "dd/MM/yyyy") {
    return new Intl.DateTimeFormat("en-GB", options).format(new Date(date));
  } else if (formatStr === "MM/dd/yyyy") {
    return new Intl.DateTimeFormat("en-US", options).format(new Date(date));
  } else if (formatStr === "yyyy-MM-dd") {
    return new Intl.DateTimeFormat("en-CA", options).format(new Date(date));
  } else {
    return new Intl.DateTimeFormat("en-GB", options).format(new Date(date));
  }
};
