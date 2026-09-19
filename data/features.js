/**
 * The optional modules a company's plan can switch on or off.
 *
 * This is the single source of truth for plan gating. Three things derive from
 * it and none of them may hold their own copy of the list:
 *
 *   models/companyModel.js  builds `featuresSchema` — what is stored
 *   lib/tenantPlan.js       builds `FEATURE_BY_PATH` — which path needs which flag
 *   app/platform/.../tenantDetail.jsx  renders the switches — what an admin sees
 *
 * Before this file those three lists were maintained separately, and the
 * failure when they disagreed was silent in both directions: a key in the UI
 * but not the schema is a switch that saves nothing, a key in the schema but
 * not FEATURE_BY_PATH is a flag that gates nothing. Adding a module is now one
 * edit here.
 *
 * Deliberately dependency-free: `proxy.js` imports lib/tenantPlan.js, which
 * imports this, and middleware runs on the edge runtime where anything pulling
 * in mongoose or React would fail to build.
 *
 * FIELDS
 *   key          the boolean stored at `company.features[key]`
 *   group        heading it sits under in the platform console. Thirteen
 *                switches in one flat list is not something anyone can read.
 *   label        what the platform admin sees on the switch
 *   description  what switching it off actually takes away
 *   paths        menu/URL prefixes gated by the flag. A path matches itself and
 *                anything beneath it, and the longest match wins — so a child
 *                path may sit under a different flag than its parent.
 *   requires     keys that must also be on for this one to make sense.
 *                Enforced in both directions by resolveFeatureDependencies()
 *                in lib/tenantPlan.js, on save as well as in the UI.
 *   core         true for modules that must never be gateable. None yet — the
 *                field exists so that decision has somewhere to be recorded
 *                rather than being implied by a key's absence. The non-gateable
 *                *paths* are listed in CORE_PATHS below.
 *
 * Every flag defaults to ON. A company created before a flag existed, or one
 * whose document simply lacks the key, keeps the module — see isFeatureEnabled
 * in lib/tenantPlan.js. That default is what makes adding a flag here safe to
 * deploy: nobody loses a module until someone switches it off on purpose.
 */
export const FEATURES = [
  {
    key: "crm",
    group: "Front desk & visitors",
    label: "CRM",
    description: "Lead capture and follow-up.",
    paths: ["/admin/leads"],
    requires: [],
    core: false,
  },
  {
    key: "expenses",
    group: "Finance",
    label: "Expenses",
    description: "Expense claims, approval and invoicing.",
    paths: ["/admin/expense"],
    requires: [],
    core: false,
  },
  {
    key: "visitors",
    group: "Front desk & visitors",
    label: "Visitors",
    description: "Visitor sign-in and the front-desk log.",
    paths: ["/admin/visitors"],
    requires: [],
    core: false,
  },
  {
    key: "siteProjects",
    group: "Sites & projects",
    label: "Site projects",
    description:
      "Project sites, the managers who run them and the day-to-day " +
      "assignments onto them.",
    paths: ["/admin/siteProject", "/admin/siteAssign", "/admin/siteAssignEmployee"],
    // Site assignments put site employees onto sites, so this module cannot do
    // its job without them. Enforced, not just advertised: switching site
    // employees off switches this off too, on save as well as in the console.
    requires: ["siteEmployees"],
    core: false,
  },
  {
    key: "siteEmployees",
    group: "Workforce",
    label: "Site employees",
    description:
      "The second workforce that signs into the /employee portal, separate " +
      "from office staff. A company with one staff population does not need it.",
    // The portal itself is listed, not just the admin screens: with the module
    // off there are no site employees, so the portal has nobody to serve.
    paths: ["/admin/employee", "/admin/previousEmployee", "/employee"],
    requires: [],
    core: false,
  },
  {
    key: "weeklyRota",
    group: "Workforce",
    label: "Weekly rota",
    description:
      "Shift planning and the personal shift view. Salaried offices that do " +
      "not roster have no use for it.",
    paths: ["/admin/weeklyRota", "/admin/me/shifts", "/admin/my-weekly-shifts"],
    requires: [],
    core: false,
  },
  {
    key: "leave",
    group: "Workforce",
    label: "Leave management",
    description:
      "Leave requests, approval and the personal leave view. Off for " +
      "companies that run leave in a separate HR system.",
    paths: ["/admin/leaveManagement", "/admin/me/leave", "/admin/my-leaves"],
    requires: [],
    core: false,
  },
  {
    key: "attendanceReports",
    group: "Workforce",
    label: "Attendance reports",
    description:
      "The attendance filter and reporting screen. Recording attendance is " +
      "core and stays on; only the reporting layer is optional.",
    paths: ["/admin/filterAttendance"],
    requires: [],
    core: false,
  },
  {
    key: "reception",
    group: "Front desk & visitors",
    label: "Reception desk",
    description:
      "The front-desk portal for signing people in and scanning passes.",
    paths: ["/hr", "/admin/reception"],
    requires: [],
    core: false,
  },
  {
    key: "documents",
    group: "Communication & files",
    label: "Documents",
    description: "The shared media library and file management.",
    paths: ["/admin/document"],
    requires: [],
    core: false,
  },
  {
    key: "devices",
    group: "Advanced",
    label: "Devices",
    description: "Registered clocking devices and their status.",
    paths: ["/admin/device", "/admin/device-info"],
    requires: [],
    core: false,
  },
  {
    key: "ai",
    group: "Advanced",
    label: "AI",
    description: "AI-assisted features.",
    paths: ["/admin/ai"],
    requires: [],
    core: false,
  },
  {
    key: "announcements",
    group: "Communication & files",
    label: "Announcements",
    description:
      "Writing and sending company-wide announcements. Reading ones already " +
      "sent is never gated.",
    // Only the authoring side. /admin/my-announcements is deliberately absent:
    // if a company's module is switched off, people must still be able to read
    // what was already sent to them.
    paths: ["/admin/announcements"],
    requires: [],
    core: false,
  },
];

/**
 * The order groups are shown in, roughly most-companies-first.
 *
 * Derived from FEATURES rather than written out, so a module given a new group
 * name cannot end up in a group the console never renders.
 */
export const FEATURE_GROUPS = [
  "Workforce",
  "Sites & projects",
  "Front desk & visitors",
  "Finance",
  "Communication & files",
  "Advanced",
].filter((group) => FEATURES.some((f) => f.group === group));

/**
 * Starting points for the common verticals.
 *
 * A preset is a *starting point*, not a mode: applying one sets the switches and
 * nothing else is stored. The company's plan remains the thirteen booleans, so
 * there is exactly one thing to read when deciding what a company may use. A
 * stored "industry" that gating consulted would be a second source of truth, and
 * the two would eventually disagree.
 *
 * Each preset lists only what it switches OFF. That way a module added to
 * FEATURES later is ON under every existing preset, which matches the
 * absent-means-enabled rule everywhere else — the alternative silently excludes
 * new modules from customers who were never asked.
 */
export const FEATURE_PRESETS = [
  {
    key: "construction",
    label: "Construction",
    description: "Everything on. Sites, site crews and rotas.",
    off: [],
  },
  {
    key: "healthcare",
    label: "Healthcare / clinic",
    description:
      "One staff population, a front desk, rotas. No sites or site crews.",
    off: ["siteProjects", "siteEmployees", "devices"],
  },
  {
    key: "warehouse",
    label: "Warehouse / logistics",
    description: "Shift crews and rotas, but no project sites and no visitors.",
    off: ["siteProjects", "visitors", "crm"],
  },
  {
    key: "office",
    label: "Office / professional",
    description: "Salaried office staff. No sites, crews or device inventory.",
    off: ["siteProjects", "siteEmployees", "devices", "visitors"],
  },
];

/**
 * Turn a preset into the full flag map the console and the save action expect.
 *
 * Every key is written explicitly rather than leaving the excluded ones absent:
 * absent means enabled, so a partial map would quietly switch the omitted
 * modules back on.
 */
export function featuresForPreset(presetKey) {
  const preset = FEATURE_PRESETS.find((p) => p.key === presetKey);
  if (!preset) return null;
  const off = new Set(preset.off);
  return Object.fromEntries(FEATURES.map((f) => [f.key, !off.has(f.key)]));
}

/**
 * Paths that are deliberately NOT gateable, and why.
 *
 * Nothing reads this — gating works by a path's *absence* from a module above.
 * That absence is indistinguishable from an oversight, which is the problem:
 * "is /admin/auditLogs ungated on purpose?" had no answer anywhere. Listing
 * them makes the decision reviewable, and makes an accidentally-ungated path
 * stand out as missing from both lists.
 *
 * The test is whether a company could still be operated without it. Signing in,
 * knowing who your staff are, recording their attendance, and being able to see
 * and change your own settings are not modules anyone opts out of.
 */
export const CORE_PATHS = {
  "/admin/dashboard": "Landing page for every admin.",
  "/admin/officeEmployee": "The primary staff list. Every company has one.",
  "/admin/profileRequests":
    "Corrections staff ask for on their own records. Follows the staff list.",
  "/admin/previousOfficeEmployee": "Follows the active office staff list.",
  "/admin/attendance": "Recording attendance is the product's core job.",
  "/admin/my-attendance": "A person's own record of their own attendance.",
  "/admin/my-announcements": "Reading what was sent to you is never a privilege.",
  "/admin/roleType": "Departments — structural, used across every module.",
  "/admin/permissions": "Granting access cannot itself require a module.",
  "/admin/company": "The company's own record.",
  "/admin/settings": "Branding and domains.",
  "/admin/email": "Outgoing mail identity; password resets depend on it.",
  "/admin/auditLogs": "The record of who did what. Never optional.",
  // Matched by prefix, longest first — so this covers /admin/me/profile,
  // /admin/me/documents, /admin/me/security and /admin/me/attendance, while
  // /admin/me/shifts and /admin/me/leave are longer entries above and stay
  // gated by their own module.
  "/admin/me": "A person's own profile, documents and security.",
  "/admin/account": "Redirects to /admin/me; must survive to do so.",
  "/admin/reportIssue": "Support route; must survive any plan.",
};

/**
 * Modules whose pages exist and are gated, but which have no sidebar entry in
 * data/menu.js — so today the flag only decides whether someone typing the URL
 * gets in.
 *
 * Not a defect in the gating: the flags work. It is a note that switching one
 * ON does not currently make the module appear for anyone, so the platform UI
 * should not imply that it will. Deciding whether these belong in the sidebar is
 * a product question, not a plan-gating one.
 */
export const UNLINKED_FEATURE_KEYS = new Set(["crm", "visitors", "devices"]);

/** Flag keys, in the order they are displayed. */
export const FEATURE_KEYS = FEATURES.map((f) => f.key);

/** Look a module up by its key. */
export const FEATURE_BY_KEY = Object.fromEntries(
  FEATURES.map((feature) => [feature.key, feature])
);

/**
 * Every gated path mapped to the key that gates it.
 *
 * Built here rather than written out because a path listed under two modules,
 * or under a module that no longer exists, would otherwise be invisible until
 * something failed to gate at runtime.
 */
export const PATH_TO_FEATURE = Object.fromEntries(
  FEATURES.flatMap((feature) => feature.paths.map((path) => [path, feature.key]))
);
