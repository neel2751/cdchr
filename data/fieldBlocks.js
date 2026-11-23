/**
 * Which parts of the site employee form a company uses.
 *
 * The second group of people — site employees in construction, agency staff in
 * a restaurant, students in a tuition centre — lives in one collection and is
 * entered on one form. What that form asks for is not the same for all of
 * them: a builder needs a pay rate, CIS and a right to work check, a tuition
 * centre needs a parent's phone number and a student's allergies, and asking
 * either for the other's details is how the product reads as built for
 * somebody else.
 *
 * So the form is built from BLOCKS, and a company switches blocks on and off.
 * Its industry template (data/terminology.js) supplies the starting set. As
 * with words, no code asks which industry a company is in: it asks whether a
 * block is on. Fields outside every block — name, contact, address, join date,
 * emergency contact — are asked of everyone.
 *
 * A block that is off is not asked for, not required, and not shown in lists:
 * a company without the pay block has no pay column, no pay validation and no
 * payroll label on its people.
 *
 * Deliberately dependency-free apart from data/terminology.js, which is too.
 */
import { industryTemplate } from "@/data/terminology";

/**
 * `fields` are form field names in data/fields/fields.js. `required` are those
 * the server insists on while the block is on — the form's own validation is a
 * convenience, the server's is the rule. `requires` names blocks that must be
 * on for this one to mean anything.
 */
export const FIELD_BLOCKS = [
  {
    key: "pay",
    label: "Pay",
    help: "Payment type, pay frequency, pay rate and bank details.",
    fields: [
      "paymentType",
      "payType",
      "payRate",
      "accountName",
      "bankName",
      "accountNumber",
      "sortCode",
    ],
    required: ["paymentType", "payType", "payRate"],
    requires: [],
  },
  {
    key: "constructionTax",
    label: "UK construction tax (CIS)",
    help: "CIS deduction and UTR, for subcontractors paid under CIS.",
    fields: ["cisDeduction", "utr"],
    required: ["cisDeduction"],
    requires: ["pay"],
  },
  {
    key: "employment",
    label: "Employment",
    help: "Role and National Insurance number.",
    fields: ["employeRole", "employeNI"],
    required: ["employeRole"],
    requires: [],
  },
  {
    key: "rightToWork",
    label: "Right to work",
    help: "Immigration status, visa dates, and right to work checks and reminders.",
    fields: ["immigrationType", "immigrationCategory", "visaStartDate", "eVisaExp"],
    required: ["immigrationType"],
    requires: [],
  },
  {
    key: "guardian",
    label: "Parent or guardian",
    help: "Who to contact about them, for students and other young people.",
    fields: [
      "guardianName",
      "guardianRelation",
      "guardianPhone",
      "guardianEmail",
    ],
    required: ["guardianName", "guardianPhone"],
    requires: [],
  },
  {
    key: "medical",
    label: "Medical and allergies",
    help: "Conditions and allergies the people looking after them need to know.",
    fields: ["medicalNotes"],
    required: [],
    requires: [],
  },
  {
    key: "education",
    label: "School and year",
    help: "Which school they attend and their year or grade.",
    fields: ["schoolName", "yearGroup"],
    required: [],
    requires: [],
  },
];

export const FIELD_BLOCK_KEYS = FIELD_BLOCKS.map((b) => b.key);

const BLOCK_OF_FIELD = Object.fromEntries(
  FIELD_BLOCKS.flatMap((b) => b.fields.map((name) => [name, b.key]))
);

/** The block a form field belongs to, or undefined for one everybody gets. */
export function blockOfField(name) {
  return BLOCK_OF_FIELD[name];
}

/**
 * Which blocks a company uses: its template's set, with the company's own
 * switches on top, then any block whose prerequisite is off switched off too.
 *
 * `templateBlocks` is the industry template's list of keys (see
 * INDUSTRY_TEMPLATES in data/terminology.js); `stored` is the company's
 * `fieldBlocks`, where an absent key means "as the template says".
 *
 * @returns {Record<string, boolean>}
 */
export function resolveFieldBlocks(templateBlocks = [], stored = {}) {
  const on = {};
  for (const key of FIELD_BLOCK_KEYS) {
    on[key] =
      typeof stored?.[key] === "boolean"
        ? stored[key]
        : templateBlocks.includes(key);
  }
  for (const block of FIELD_BLOCKS) {
    if (block.requires.some((req) => !on[req])) on[block.key] = false;
  }
  return on;
}

/** Keep only the form fields whose block is on. */
export function filterFieldsByBlocks(fields, blocks) {
  return fields.filter((field) => {
    const block = blockOfField(field?.name);
    return !block || blocks?.[block] !== false;
  });
}

/**
 * The fields a save must carry, given the blocks that are on. A field with a
 * `showIf` on the form is not listed in any block's `required`, so this never
 * demands something the form legitimately hid.
 */
export function requiredFieldsFor(blocks) {
  return FIELD_BLOCKS.filter((b) => blocks?.[b.key]).flatMap((b) => b.required);
}

/** Every field belonging to a block that is off — to drop from a save. */
export function fieldsOfDisabledBlocks(blocks) {
  return FIELD_BLOCKS.filter((b) => blocks?.[b.key] === false).flatMap(
    (b) => b.fields
  );
}

/** A company's blocks, from its document (`industry` and `fieldBlocks`). */
export function resolveCompanyBlocks(company) {
  return resolveFieldBlocks(
    industryTemplate(company?.industry).blocks,
    company?.fieldBlocks
  );
}
