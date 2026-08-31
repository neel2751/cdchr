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

/**
 * Format an amount in a company's own currency.
 *
 * The locale is derived from the currency rather than fixed at "en-GB", so EUR
 * renders as "€1.234,56" where a German company expects it instead of
 * "€1,234.56". Defaults stay GBP/en-GB, so every existing caller is unchanged.
 *
 * Pass `tenantBranding.locale.currency` — see resolveLocale() in lib/tenant.js.
 * A component can reach it through useBranding().
 */
const CURRENCY_LOCALE = {
  GBP: "en-GB",
  EUR: "de-DE",
  USD: "en-US",
  INR: "en-IN",
  AUD: "en-AU",
  CAD: "en-CA",
};

export const formatCurrency = (value, currency = "GBP") => {
  // null and "" are excluded before Number() sees them: both coerce to 0, and
  // "£0.00" where there is no figure at all is a quietly wrong answer rather
  // than a missing one. Also covers the literal "NaN" the old signature
  // special-cased, and the undefined that used to render "£NaN".
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";

  const code = currency || "GBP";
  try {
    return new Intl.NumberFormat(CURRENCY_LOCALE[code] || "en-GB", {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    // An unrecognised currency code throws rather than degrading. A wrong
    // symbol beats a blank page.
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(amount);
  }
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
