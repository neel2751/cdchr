/**
 * The caller's IP address, read so that it can be trusted.
 *
 * `X-Forwarded-For` is a list, and Caddy **appends** to whatever the client
 * sent rather than replacing it. A client that sends
 *
 *     X-Forwarded-For: 203.0.113.9
 *
 * arrives at the app as
 *
 *     X-Forwarded-For: 203.0.113.9, 198.51.100.7
 *                      ^ the client chose this   ^ Caddy observed this
 *
 * So the first entry — which is what `header.split(",")[0]` and the bare
 * `h.get("x-forwarded-for")` used elsewhere in this codebase both give you — is
 * a value the caller picked. Reading that and calling it an IP address is fine
 * for an audit note and a rate-limit bucket, and is a spoofable authorisation
 * bypass the moment a network allowlist depends on it.
 *
 * The **last** entry is the one our own proxy observed. That is the one to use.
 *
 * CLOCK_LOCATION_PLAN.md §7.1 marks this as blocking for the IP method.
 *
 * ONE ASSUMPTION, and it is worth re-checking if the deployment changes: that
 * exactly one trusted proxy (Caddy) sits in front of the app. Put a CDN in
 * front of Caddy and the hop to trust moves one place left; `TRUSTED_HOPS`
 * below is where that is expressed.
 */

// How many proxies we control sit in front of the app. Caddy, and only Caddy.
const TRUSTED_HOPS = Number(process.env.TRUSTED_PROXY_HOPS || 1);

/**
 * @param {Headers} headers a request's headers (from `next/headers` or a Request)
 * @returns {string|null} the address our own proxy observed, or null
 */
export function getClientIp(headers) {
  if (!headers?.get) return null;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);

    // Count in from the right: the rightmost entry was added by the nearest
    // proxy. With one trusted hop that is the last entry.
    const index = hops.length - TRUSTED_HOPS;
    const chosen = hops[index] ?? hops[hops.length - 1];
    if (chosen) return normalise(chosen);
  }

  // Set by the proxy itself rather than forwarded from the client, so it is
  // not attacker-controlled in the same way — but it is also not always set.
  const real = headers.get("x-real-ip");
  return real ? normalise(real.trim()) : null;
}

/**
 * Strip the noise that stops two spellings of one address matching.
 *
 * `::ffff:203.0.113.9` is an IPv4 address in IPv6 clothing, and a port suffix
 * is not part of the address. A CIDR check against either would fail for a
 * client that is genuinely inside the range.
 */
function normalise(address) {
  let ip = address;

  if (ip.startsWith("[")) {
    // [2001:db8::1]:443
    const close = ip.indexOf("]");
    if (close > 0) return ip.slice(1, close);
  }

  if (ip.toLowerCase().startsWith("::ffff:")) ip = ip.slice(7);

  // A single colon means IPv4 with a port; several means it is IPv6 and the
  // colons belong to the address.
  const colons = (ip.match(/:/g) || []).length;
  if (colons === 1) ip = ip.split(":")[0];

  return ip;
}
