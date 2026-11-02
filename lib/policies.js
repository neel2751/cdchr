/**
 * What the policy screens and the policy server both need to agree on.
 *
 * Kept out of server/policyServer: those files carry "use server", which only
 * permits async function exports, and the browser needs these lists too.
 */

/**
 * The shelves every company starts with. Created the first time the library
 * is opened; after that they are the company's own to rename or archive.
 */
export const DEFAULT_POLICY_CATEGORIES = [
  {
    name: "HR",
    description: "Conduct, leave, grievance, disciplinary and equality.",
  },
  {
    name: "IT",
    description: "Acceptable use, passwords, devices and remote working.",
  },
  {
    name: "Finance",
    description: "Expenses, purchasing, approvals and anti-bribery.",
  },
  {
    name: "Health & Safety",
    description: "Risk assessments, first aid, accident reporting and PPE.",
  },
  {
    name: "Fire Safety",
    description: "Evacuation, fire wardens, alarms and assembly points.",
  },
  {
    name: "Data Protection",
    description: "GDPR, data retention, subject access and breaches.",
  },
];

/**
 * Files a policy may be.
 *
 * A policy is something people read, so: documents and the images a scanned
 * one arrives as. Nothing executable, and no archives — a zip is a way to
 * publish something nobody has looked inside.
 */
export const POLICY_FILE_TYPES = {
  "application/pdf": "PDF",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "Word",
  "image/png": "Image",
  "image/jpeg": "Image",
};

/** The `accept` attribute for the upload input, from the same list. */
export const POLICY_FILE_ACCEPT = Object.keys(POLICY_FILE_TYPES).join(",");

/**
 * Policy files go straight from the browser to storage, so this is not bound
 * by the 1 MB server-action body limit. 25 MB is a long handbook as a PDF; a
 * file larger than that is usually a scan at a resolution nobody needs.
 */
export const POLICY_MAX_BYTES = 25 * 1024 * 1024;

/** A category name folded for comparison: "Fire  safety " = "fire safety". */
export function policyNameKey(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** "2.4 MB", for the upload dialog and the version list. */
export function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
