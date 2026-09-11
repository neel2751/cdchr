/**
 * Labels and option lists shared by the announcement screens.
 *
 * Kept out of the server files because those carry "use server", which only
 * permits async function exports — a constant there is a build error.
 */

export const CATEGORY_OPTIONS = [
  { label: "General", value: "general" },
  { label: "Policy", value: "policy" },
  { label: "HR", value: "hr" },
  { label: "Safety", value: "safety" },
  { label: "IT", value: "it" },
  { label: "Event", value: "event" },
];

export const PRIORITY_OPTIONS = [
  { label: "Normal", value: "normal" },
  { label: "Important", value: "important" },
  { label: "Urgent", value: "urgent" },
];

export const STATUS_OPTIONS = [
  { label: "All statuses", value: "" },
  { label: "Draft", value: "draft" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Published", value: "published" },
  { label: "Archived", value: "archived" },
];

export const ROLE_OPTIONS = [
  { label: "Super admins", value: "superAdmin" },
  { label: "Admins", value: "admin" },
  { label: "Office staff", value: "user" },
  // Field staff hold exactly one role, and picking it here is the same as
  // including them — so it is shown with the others rather than hidden behind
  // the include-field toggle.
  { label: "Site staff", value: "siteEmployee", field: true },
];

export const AUDIENCE_MODE_OPTIONS = [
  { label: "Everyone", value: "all", hint: "Everyone at the company" },
  { label: "By role", value: "roles", hint: "Admins, office or site staff" },
  { label: "By department", value: "departments", hint: "Office departments" },
  { label: "By site", value: "sites", hint: "Everyone on a project site" },
  { label: "Specific people", value: "people", hint: "Hand-picked individuals" },
];

export const STATUS_VARIANT = {
  draft: "outline",
  scheduled: "secondary",
  published: "default",
  archived: "secondary",
};

export const PRIORITY_VARIANT = {
  normal: "outline",
  important: "secondary",
  urgent: "destructive",
};

const LABEL = (options) =>
  Object.fromEntries(options.map((o) => [o.value, o.label]));

export const CATEGORY_LABEL = LABEL(CATEGORY_OPTIONS);
export const PRIORITY_LABEL = LABEL(PRIORITY_OPTIONS);
export const ROLE_LABEL = LABEL(ROLE_OPTIONS);

/**
 * Plain-language summary of an audience, for the list and detail header.
 *
 * Says whether site staff are included, because that is the difference between
 * reaching 30 people and reaching 300 and is not otherwise visible in a list.
 *
 * @param {object} audience
 * @param {{departments?:object, sites?:object}} names lookup maps, id -> label
 */
export function describeAudience(audience, names = {}) {
  const departmentNames = names.departments || names;
  const siteNames = names.sites || {};
  const mode = audience?.mode || "all";
  // "sites" and "people" name field staff outright, so the suffix would be
  // noise there; the other modes need the opt-in spelled out.
  const withField =
    audience?.includeField && mode !== "sites" && mode !== "people"
      ? " + site staff"
      : "";

  if (mode === "all") return `Everyone${withField ? "" : " in the office"}${withField}`;

  if (mode === "roles") {
    const labels = (audience?.roles || []).map((r) => ROLE_LABEL[r] || r);
    return labels.length ? labels.join(", ") : "No one";
  }

  if (mode === "departments") {
    const labels = (audience?.departments || []).map(
      (d) => departmentNames[String(d)] || "Unknown department"
    );
    return labels.length ? `${labels.join(", ")}${withField}` : "No one";
  }

  if (mode === "sites") {
    const labels = (audience?.sites || []).map(
      (s) => siteNames[String(s)] || "Unknown site"
    );
    return labels.length ? labels.join(", ") : "No one";
  }

  if (mode === "people") {
    const count = (audience?.people || []).length;
    if (!count) return "No one";
    return `${count} selected ${count === 1 ? "person" : "people"}`;
  }

  return "No one";
}
