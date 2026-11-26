import { RESERVED_SUBDOMAINS } from "@/lib/tenantHost";

/**
 * A workspace address: the `acme` in acme.example.com. One set of rules for
 * self-serve signup and for a company the platform admin creates.
 */

/** Same shape the company schema enforces. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Why a slug cannot be used, or "" when it is fine.
 * Format only — availability needs the database and is checked separately.
 */
export function slugComplaint(slug) {
  if (!slug) return "Pick a workspace address";
  if (slug.length < 3) return "Use at least 3 characters";
  if (slug.length > 63) return "Use 63 characters or fewer";
  if (!SLUG_PATTERN.test(slug)) {
    return "Use lowercase letters, numbers and hyphens, not starting or ending with a hyphen";
  }
  // These resolve to the platform's own hosts, so a tenant can never hold one.
  if (RESERVED_SUBDOMAINS.has(slug)) return "That address is reserved";
  return "";
}

/** An address suggested from a company name: "Acme & Sons" → "acme-and-sons". */
export function suggestSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}
