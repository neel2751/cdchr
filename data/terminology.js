/**
 * What each company calls the things the app is built around.
 *
 * The app was written for construction, so its screens say "site", "site
 * employee" and "site manager". The same machinery serves a tuition centre (a
 * class, a student, a class teacher) or a restaurant (a branch, agency staff, a
 * branch manager) unchanged — only the words differ. So the words are data: an
 * industry template supplies them, and a company may replace any of them.
 *
 * THE RULE THAT MAKES THIS WORK: no code asks which industry a company is in.
 * Code asks for a word. A new industry is a new entry in INDUSTRY_TEMPLATES and
 * nothing else; a branch on `industry === "tuition"` anywhere would be the
 * first step back to a separate product per industry.
 *
 * Database fields, URLs and identifiers keep their construction names
 * (`siteId`, /admin/siteProject). Nobody reads those, and renaming them would
 * be a large, risky change with nothing to show for it.
 *
 * TOKENS. Text that names one of these things is written with a token, and
 * fillTerms() swaps in the company's word:
 *
 *   "{Site} Name"        -> "Site Name"  / "Class Name"
 *   "Select a {site}"    -> "Select a site" / "Select a class"
 *
 * A token is a key from TERM_FIELDS. Written with a capital first letter it is
 * replaced by the word as stored ("Class Teacher"); with a lower-case first
 * letter, by the word in lower case ("class teacher"), for the middle of a
 * sentence. An unknown token is left as it is, so a typo shows on screen
 * rather than vanishing.
 *
 * Deliberately dependency-free, like data/features.js: the model, the menu,
 * server actions and client components all import it.
 */

/**
 * Every word a company can set, in the order the settings screen lists them.
 * `label` and `help` are what the person choosing the words reads.
 */
export const TERM_FIELDS = [
  {
    key: "site",
    label: "A place",
    help: "Where people work or attend. One of them.",
  },
  { key: "sites", label: "Places", help: "More than one." },
  {
    key: "siteList",
    label: "Places menu",
    help: "The menu entry and page that lists them.",
  },
  {
    key: "siteEmployee",
    label: "A person at a place",
    help: "The second group of people, apart from office staff. One of them.",
  },
  { key: "siteEmployees", label: "People at places", help: "More than one." },
  {
    key: "previousSiteEmployees",
    label: "Former people at places",
    help: "The menu entry for those who have left.",
  },
  {
    key: "siteManager",
    label: "A place manager",
    help: "Office staff put in charge of a place. One of them.",
  },
  { key: "siteManagers", label: "Place managers", help: "More than one." },
  {
    key: "siteAssignments",
    label: "Assignments",
    help: "Putting people onto a place: the menu entry and board.",
  },
];

export const TERM_KEYS = TERM_FIELDS.map((f) => f.key);

/** The longest word a company may set. Menu entries have to fit. */
export const TERM_MAX_LENGTH = 40;

/**
 * Starting points. `terms` must give every key in TERM_FIELDS.
 *
 * Construction is exactly what the screens said before this file existed, so
 * an existing company sees no change. `featurePreset` names the FEATURE_PRESETS
 * entry in data/features.js that suits the same kind of business.
 */
export const INDUSTRY_TEMPLATES = [
  {
    key: "construction",
    label: "Construction",
    featurePreset: "construction",
    terms: {
      site: "Site",
      sites: "Sites",
      siteList: "Project Sites",
      siteEmployee: "Site Employee",
      siteEmployees: "Site Employees",
      previousSiteEmployees: "Previous Site Employees",
      siteManager: "Site Manager",
      siteManagers: "Site Managers",
      siteAssignments: "Site Assignments",
    },
  },
  {
    key: "restaurant",
    label: "Restaurant / hospitality",
    featurePreset: "restaurant",
    terms: {
      site: "Branch",
      sites: "Branches",
      siteList: "Branches",
      siteEmployee: "Agency Worker",
      siteEmployees: "Agency Staff",
      previousSiteEmployees: "Previous Agency Staff",
      siteManager: "Branch Manager",
      siteManagers: "Branch Managers",
      siteAssignments: "Branch Assignments",
    },
  },
  {
    key: "tuition",
    label: "Tuition / classes",
    featurePreset: "tuition",
    terms: {
      site: "Class",
      sites: "Classes",
      siteList: "Classes",
      siteEmployee: "Student",
      siteEmployees: "Students",
      previousSiteEmployees: "Former Students",
      siteManager: "Class Teacher",
      siteManagers: "Class Teachers",
      siteAssignments: "Enrolments",
    },
  },
];

export const DEFAULT_INDUSTRY = "construction";

export function industryTemplate(key) {
  return (
    INDUSTRY_TEMPLATES.find((t) => t.key === key) ||
    INDUSTRY_TEMPLATES.find((t) => t.key === DEFAULT_INDUSTRY)
  );
}

/**
 * Only known keys, trimmed, non-empty and not too long. Applied to what a
 * company saves and again to what is read back, so a crafted payload cannot
 * put anything else on the page.
 */
export function cleanTerms(raw) {
  const clean = {};
  if (!raw || typeof raw !== "object") return clean;
  for (const key of TERM_KEYS) {
    const value = raw[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (trimmed && trimmed.length <= TERM_MAX_LENGTH) clean[key] = trimmed;
  }
  return clean;
}

/**
 * The words a company uses: its template's, with its own choices on top.
 *
 * Takes the company document (or anything with `industry` and `terms`). An
 * unknown or missing industry is construction — what every company was before.
 */
export function resolveTerms(company) {
  return {
    ...industryTemplate(company?.industry).terms,
    ...cleanTerms(company?.terms),
  };
}

const DEFAULT_TERMS = industryTemplate(DEFAULT_INDUSTRY).terms;

/**
 * Replace `{Token}` and `{token}` in `text` with the company's words. Anything
 * that is not a string is returned unchanged.
 */
export function fillTerms(text, terms = DEFAULT_TERMS) {
  if (typeof text !== "string" || !text.includes("{")) return text;
  const words = terms || DEFAULT_TERMS;
  return text.replace(/\{([A-Za-z]+)\}/g, (match, token) => {
    const key = token.charAt(0).toLowerCase() + token.slice(1);
    const word = words[key] ?? DEFAULT_TERMS[key];
    if (word === undefined) return match;
    return token.charAt(0) === token.charAt(0).toUpperCase()
      ? word
      : word.toLowerCase();
  });
}

/**
 * fillTerms over every string in a field definition array — labels,
 * placeholders, help text and validation messages alike. Recurses into plain
 * objects and arrays only, so a RegExp or a function passes through untouched.
 */
export function fillTermsDeep(value, terms = DEFAULT_TERMS) {
  if (typeof value === "string") return fillTerms(value, terms);
  if (Array.isArray(value)) return value.map((v) => fillTermsDeep(v, terms));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fillTermsDeep(v, terms)]),
    );
  }
  return value;
}

/**
 * A menu entry's label in the company's words. Entries that name one of these
 * things carry a `termKey` (see data/menu.js); the rest keep their `name`.
 */
export function menuLabel(item, terms = DEFAULT_TERMS) {
  if (!item?.termKey) return item?.name;
  return (terms || DEFAULT_TERMS)[item.termKey] ?? DEFAULT_TERMS[item.termKey] ?? item.name;
}
