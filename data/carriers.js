/**
 * Carriers we hand parcels to, and where their tracking pages live.
 *
 * The point of this file is that "shipped, ref 1234567890" is not a delivery.
 * A customer given a bare reference has to work out which carrier's site to
 * paste it into; given a link, they do not have to ask us anything.
 *
 * `track` is a template with `{ref}` substituted. A carrier with no template
 * is still usable — the reference is shown as plain text — which is what
 * `other` is for, and what any carrier whose URL we get wrong degrades to
 * rather than offering a link that 404s.
 *
 * ---------------------------------------------------------------------------
 * THESE URLS ARE THE ONE THING IN HERE THAT ROTS.
 *
 * They are the public tracking pages as best known, not verified against each
 * carrier's current site, and carriers change them without notice. Treat a
 * broken link as a data fix here, not a bug in the order code — and if a
 * carrier's format is uncertain, prefer no template over a wrong one, because
 * a missing link reads as "copy this reference" while a broken one reads as
 * "your parcel does not exist".
 * ---------------------------------------------------------------------------
 */
export const CARRIERS = [
  {
    key: "royal-mail",
    name: "Royal Mail",
    track: "https://www.royalmail.com/track-your-item#/tracking-results/{ref}",
  },
  {
    key: "parcelforce",
    name: "Parcelforce",
    track: "https://www.parcelforce.com/track-trace?trackNumber={ref}",
  },
  {
    key: "dpd",
    name: "DPD",
    track: "https://track.dpd.co.uk/search?reference={ref}",
  },
  {
    key: "evri",
    name: "Evri",
    track: "https://www.evri.com/track/parcel/{ref}",
  },
  {
    key: "yodel",
    name: "Yodel",
    track: "https://www.yodel.co.uk/track/{ref}",
  },
  {
    key: "ups",
    name: "UPS",
    track: "https://www.ups.com/track?tracknum={ref}",
  },
  {
    key: "dhl",
    name: "DHL",
    track: "https://www.dhl.com/gb-en/home/tracking.html?tracking-id={ref}",
  },
  {
    key: "fedex",
    name: "FedEx",
    track: "https://www.fedex.com/fedextrack/?trknbr={ref}",
  },
  {
    // Hand delivery, a courier we have no template for, or collection. The
    // reference is whatever is useful to a human.
    key: "other",
    name: "Other / hand delivered",
    track: null,
  },
];

export const CARRIER_KEYS = CARRIERS.map((c) => c.key);

/** The carrier record, or null for an unknown key. */
export function findCarrier(key) {
  if (!key) return null;
  return CARRIERS.find((c) => c.key === key) || null;
}

/** What to call it on screen, falling back to whatever was stored. */
export function carrierName(key) {
  return findCarrier(key)?.name || key || "";
}

/**
 * A tracking link, or null when there is nothing safe to link to.
 *
 * Returns null rather than a half-built URL for an unknown carrier, a missing
 * reference, or a carrier with no template — every caller then shows the plain
 * reference, which is always useful, instead of a link that goes nowhere.
 */
export function trackingUrl(key, ref) {
  const carrier = findCarrier(key);
  const reference = (ref || "").trim();
  if (!carrier?.track || !reference) return null;
  return carrier.track.replace("{ref}", encodeURIComponent(reference));
}
