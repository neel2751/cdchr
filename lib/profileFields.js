/**
 * What an employee sees on their own record, and what they can do about it.
 *
 * One table, three answers per field:
 *
 *   self     they change it themselves, now. Address and next of kin — the
 *            things only they know, that cost nothing if wrong, and that HR
 *            spends its time chasing.
 *   request  they ask, HR decides. Corrections to what the record asserts:
 *            their name, their start date, their visa dates. Somebody has to
 *            agree that the old value was wrong.
 *   read     shown, not negotiable here. Department, employment type, days per
 *            week — these are not corrections, they are decisions, and a
 *            request form would pretend otherwise.
 *
 * Deliberately free of imports so both the server actions and the client screen
 * can share it without one dragging the other's dependencies along.
 */

export const PROFILE_SECTIONS = [
  {
    key: "personal",
    title: "Personal",
    fields: [
      { name: "name", label: "Full name", type: "text", access: "request" },
      {
        name: "dateOfBirth",
        label: "Date of birth",
        type: "date",
        access: "request",
      },
      { name: "employeId", label: "Employee ID", type: "text", access: "read" },
    ],
  },
  {
    key: "contact",
    title: "Contact",
    fields: [
      {
        name: "email",
        label: "Email",
        type: "text",
        access: "request",
        hint: "You sign in with this, so HR changes it rather than you.",
      },
      {
        name: "phoneNumber",
        label: "Phone",
        type: "number",
        access: "self",
      },
      { name: "address", label: "Address", type: "text", access: "self" },
      {
        name: "streetAddress",
        label: "Street",
        type: "text",
        access: "self",
      },
      { name: "city", label: "City", type: "text", access: "self" },
      { name: "postCode", label: "Postcode", type: "text", access: "self" },
      { name: "country", label: "Country", type: "text", access: "read" },
    ],
  },
  {
    key: "emergency",
    title: "Emergency contact",
    description: "Who we call if something happens at work.",
    fields: [
      {
        name: "emergencyName",
        label: "Name",
        type: "text",
        access: "self",
      },
      {
        name: "emergencyRelation",
        label: "Relationship",
        type: "text",
        access: "self",
      },
      {
        name: "emergencyPhoneNumber",
        label: "Phone",
        type: "number",
        access: "self",
      },
      {
        name: "emergencyAddress",
        label: "Address",
        type: "text",
        access: "self",
      },
    ],
  },
  {
    key: "employment",
    title: "Employment",
    fields: [
      {
        name: "departmentView",
        label: "Department",
        type: "text",
        access: "read",
      },
      { name: "roleType", label: "Role", type: "text", access: "read" },
      {
        name: "employeType",
        label: "Employment type",
        type: "text",
        access: "read",
      },
      {
        name: "joinDate",
        label: "Start date",
        type: "date",
        access: "request",
      },
      {
        name: "dayPerWeek",
        label: "Days per week",
        type: "number",
        access: "read",
      },
    ],
  },
  {
    key: "rightToWork",
    title: "Right to work",
    fields: [
      {
        name: "immigrationType",
        label: "Immigration status",
        type: "text",
        access: "read",
      },
      {
        name: "visaStartDate",
        label: "Visa start",
        type: "date",
        access: "request",
      },
      {
        name: "visaEndDate",
        label: "Visa expiry",
        type: "date",
        access: "request",
      },
    ],
  },
];

/**
 * The catch-all request, and the two that carry no value.
 *
 * Bank details and the NI number never travel through a change request. They
 * are stripped from every profile read by lib/sensitiveAccess.js and released
 * only against a re-typed password — putting a new sort code in a request
 * collection would route them around all of that. So these raise a note, HR
 * picks up the phone, and the value is typed on the employee's record where it
 * is already protected. That is also how payroll teams are expected to handle a
 * bank change: verified, not submitted through a form.
 */
export const NOTE_ONLY_REQUESTS = [
  {
    name: "bankDetail",
    label: "Bank details",
    blurb: "Ask HR to update where you are paid. They will confirm it with you first — never send account numbers in the note.",
  },
  {
    name: "employeNI",
    label: "National Insurance number",
    blurb: "Ask HR to correct your NI number. Leave the number out of the note; they will take it from you directly.",
  },
  {
    name: "other",
    label: "Something else",
    blurb: "Anything on this page that looks wrong and has no button of its own.",
  },
];

/** Every field, flattened, keyed by name. */
export const PROFILE_FIELDS = Object.fromEntries(
  PROFILE_SECTIONS.flatMap((section) =>
    section.fields.map((field) => [field.name, { ...field, section: section.key }])
  )
);

/** The fields an employee may write on their own record. */
export const SELF_EDITABLE_FIELDS = Object.values(PROFILE_FIELDS)
  .filter((field) => field.access === "self")
  .map((field) => field.name);

/** The fields an employee may ask HR to change, with the note-only ones. */
export const REQUESTABLE_FIELDS = {
  ...Object.fromEntries(
    Object.values(PROFILE_FIELDS)
      .filter((field) => field.access === "request")
      .map((field) => [field.name, field])
  ),
  ...Object.fromEntries(
    NOTE_ONLY_REQUESTS.map((entry) => [
      entry.name,
      { ...entry, type: "note", access: "request", noteOnly: true },
    ])
  ),
};

/** Label for a field name, falling back to the name itself. */
export function fieldLabel(name) {
  return REQUESTABLE_FIELDS[name]?.label || PROFILE_FIELDS[name]?.label || name;
}
