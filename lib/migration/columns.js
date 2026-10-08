/**
 * What a migration file is allowed to contain, and what each column means.
 *
 * A company arriving from another HR system has one spreadsheet and no appetite
 * for renaming thirty columns by hand, so matching is forgiving about spelling:
 * "Surname", "Family Name" and "Last Name" are the same column. It is *not*
 * forgiving about which columns exist. The list below is a whitelist, and that
 * is a security boundary rather than tidiness — `isAdmin`, `isSuperAdmin`,
 * `password`, `tenantId` and `delete` are all real fields on these schemas, and
 * a CSV that could set them would be a way to hand yourself super admin by
 * uploading a file. An unrecognised header is reported and then ignored.
 *
 * Pure and dependency-free by design. The browser builds the blank template and
 * previews the file with these functions, and the server validates with the
 * same ones, so the screen can never promise something the import then refuses.
 *
 * WHY TWO KINDS
 *   Office staff and site employees are different collections with different
 *   required fields — office staff sign into /admin and have a department and
 *   contracted hours; site employees sign into /employee and have a pay rate
 *   and a CIS deduction. One combined template would be mostly blank columns
 *   whichever kind you were importing, so there are two.
 */

import { toCsv } from "@/lib/csv";
import {
  cleanText,
  emailKey,
  isBlank,
  isPlausiblePhone,
  isValidEmail,
  parseChoice,
  parseFlexibleDate,
  parseNumber,
  phoneKey,
  slugify,
} from "@/lib/migration/normalize";

export const IMPORT_KINDS = [
  {
    value: "office",
    label: "Office staff",
    blurb:
      "Salaried and contracted staff who sign in to the admin area — the people on the Office Staff list.",
  },
  {
    value: "site",
    label: "Site employees",
    blurb:
      "Field workers who clock in on site and sign in to the employee app — the people on the Site Employees list.",
  },
];

const EMAIL_ALIASES = [
  "Email",
  "E-mail",
  "Email Address",
  "Work Email",
  "Company Email",
  "Login Email",
  "Personal Email",
];

const PHONE_ALIASES = [
  "Phone",
  "Mobile",
  "Mobile Number",
  "Mobile No",
  "Contact Number",
  "Contact No",
  "Telephone",
  "Tel",
  "Cell",
  "Cell Phone",
];

const IMMIGRATION_OPTIONS = [
  { value: "British", aliases: ["UK", "United Kingdom", "Settled", "Citizen"] },
  {
    value: "Immigrant",
    aliases: ["Visa", "Sponsored", "Work Visa", "Non-British"],
  },
  { value: "Other", aliases: ["Overseas", "Offshore"] },
];

/** Fields every record carries, whichever collection it lands in. */
const SHARED_TAIL = [
  {
    key: "employeNI",
    header: "NI Number",
    aliases: [
      "National Insurance",
      "National Insurance Number",
      "NINO",
      "NI",
      "NI No",
    ],
    type: "ni",
    example: "QQ123456C",
  },
  {
    key: "address",
    header: "Address Line 1",
    aliases: ["Address", "Address 1", "Street", "House Number", "Home Address"],
    type: "text",
    example: "12 Mill Lane",
  },
  {
    key: "streetAddress",
    header: "Address Line 2",
    aliases: ["Address 2", "Street Address", "Area"],
    type: "text",
    example: "Hulme",
  },
  {
    key: "city",
    header: "City",
    aliases: ["Town", "Town/City", "City/Town"],
    type: "text",
    example: "Manchester",
  },
  {
    key: "postCode",
    header: "Postcode",
    aliases: ["Post Code", "Zip", "Zip Code", "Postal Code"],
    type: "text",
    example: "M15 5FQ",
  },
  {
    key: "country",
    header: "Country",
    aliases: ["Nationality Country", "Country of Residence"],
    type: "text",
    example: "United Kingdom",
  },
  {
    key: "emergencyName",
    header: "Emergency Contact Name",
    aliases: ["Emergency Contact", "Next of Kin", "NOK", "NOK Name"],
    type: "text",
    example: "Sara Patel",
  },
  {
    key: "emergencyPhoneNumber",
    header: "Emergency Contact Phone",
    aliases: ["Emergency Phone", "Emergency Number", "NOK Phone"],
    type: "phone",
    example: "07700 900456",
  },
  {
    key: "emergencyRelation",
    header: "Emergency Contact Relationship",
    aliases: ["Emergency Relationship", "Relationship", "NOK Relationship"],
    type: "text",
    example: "Spouse",
  },
  {
    key: "emergencyAddress",
    header: "Emergency Contact Address",
    aliases: ["Emergency Address", "NOK Address"],
    type: "text",
    example: "12 Mill Lane, Manchester",
  },
  {
    key: "accountName",
    header: "Bank Account Name",
    aliases: ["Account Name", "Account Holder"],
    type: "text",
    example: "A Patel",
    sensitive: true,
  },
  {
    key: "bankName",
    header: "Bank Name",
    aliases: ["Bank"],
    type: "text",
    example: "Barclays",
    sensitive: true,
  },
  {
    key: "accountNumber",
    header: "Bank Account Number",
    aliases: ["Account Number", "Account No"],
    type: "digits",
    example: "12345678",
    sensitive: true,
  },
  {
    key: "sortCode",
    header: "Sort Code",
    aliases: ["Sortcode", "Sort-Code"],
    type: "digits",
    example: "20-00-00",
    sensitive: true,
  },
];

const OFFICE_COLUMNS = [
  {
    key: "name",
    header: "Full Name",
    aliases: ["Name", "Employee Name", "Staff Name", "Full name"],
    type: "text",
    required: true,
    example: "Anita Patel",
  },
  {
    key: "email",
    header: "Email Address",
    aliases: EMAIL_ALIASES,
    type: "email",
    required: true,
    example: "anita.patel@example.com",
    help: "How this person signs in. Must not already be in use anywhere on the platform.",
  },
  {
    key: "phoneNumber",
    header: "Phone Number",
    aliases: PHONE_ALIASES,
    type: "phone",
    required: true,
    example: "07700 900123",
  },
  {
    key: "employeId",
    header: "Employee ID",
    aliases: ["Staff ID", "Payroll Number", "Employee Number", "Emp No", "Ref"],
    type: "text",
    example: "EMP-001",
  },
  {
    key: "department",
    header: "Department",
    aliases: ["Team", "Division", "Role Department"],
    type: "lookup",
    required: true,
    example: "Operations",
    help: "Matched by name against your Departments list.",
  },
  {
    key: "roleType",
    header: "Job Title",
    aliases: ["Role", "Position", "Role Type", "Designation", "Job Role"],
    type: "text",
    required: true,
    example: "Operations Manager",
  },
  {
    key: "employeType",
    header: "Employment Type",
    aliases: ["Contract Type", "Employee Type", "Worker Type", "Contract"],
    type: "choice",
    required: true,
    options: [
      { value: "Full-Time", aliases: ["Full Time", "FT", "Permanent", "Fulltime"] },
      { value: "Part-Time", aliases: ["Part Time", "PT", "Parttime"] },
    ],
    example: "Full-Time",
  },
  {
    key: "joinDate",
    header: "Start Date",
    aliases: [
      "Join Date",
      "Date Joined",
      "Hire Date",
      "Date of Hire",
      "Employment Start Date",
      "Commencement Date",
      "Started",
    ],
    type: "date",
    required: true,
    example: "01/04/2023",
  },
  {
    key: "endDate",
    header: "End Date",
    aliases: ["Leave Date", "Leaving Date", "Termination Date", "Last Day"],
    type: "date",
    example: "",
    help: "Leave blank for current staff.",
  },
  {
    key: "dateOfBirth",
    header: "Date of Birth",
    aliases: ["DOB", "Birth Date", "Birthday", "D.O.B"],
    type: "date",
    example: "14/07/1990",
  },
  {
    key: "dayPerWeek",
    header: "Days Per Week",
    aliases: ["Days", "Working Days", "Days Worked"],
    type: "number",
    example: "5",
    default: 5,
    help: "1 to 7. Used to value a day of paid leave. Defaults to 5.",
  },
  {
    key: "weeklyHourType",
    header: "Weekly Hours Type",
    aliases: ["Hours Type"],
    type: "choice",
    options: [
      { value: "fixed", aliases: ["Company Default", "Standard", "Default"] },
      { value: "custom", aliases: ["Custom Hours", "Bespoke"] },
    ],
    default: "fixed",
    example: "fixed",
    help: '"fixed" follows the company figure in Settings; "custom" needs Hours Per Week.',
  },
  {
    key: "weeklyHours",
    header: "Hours Per Week",
    aliases: ["Weekly Hours", "Contracted Hours", "Hours"],
    type: "number",
    example: "",
  },
  {
    key: "immigrationType",
    header: "Immigration Type",
    aliases: ["Right to Work", "Nationality Status", "Immigration Status"],
    type: "choice",
    required: true,
    options: IMMIGRATION_OPTIONS,
    default: "British",
    example: "British",
  },
  {
    key: "immigrationCategory",
    header: "Immigration Category",
    aliases: ["Visa Type", "Visa Category"],
    type: "text",
    example: "",
  },
  {
    key: "visaStartDate",
    header: "Visa Start Date",
    aliases: ["Visa From"],
    type: "date",
    example: "",
  },
  {
    key: "visaEndDate",
    header: "Visa End Date",
    aliases: ["Visa Expiry", "Visa Expiry Date", "Visa To", "Visa Exp"],
    type: "date",
    example: "",
  },
  {
    key: "countryOfWork",
    header: "Country of Work",
    aliases: ["Work Country"],
    type: "text",
    example: "",
  },
  ...SHARED_TAIL,
];

const SITE_COLUMNS = [
  {
    key: "firstName",
    header: "First Name",
    aliases: ["Forename", "Given Name", "First", "Christian Name"],
    type: "text",
    required: true,
    example: "Tomasz",
  },
  {
    key: "lastName",
    header: "Last Name",
    aliases: ["Surname", "Family Name", "Last"],
    type: "text",
    required: true,
    example: "Nowak",
  },
  {
    key: "email",
    header: "Email Address",
    aliases: EMAIL_ALIASES,
    type: "email",
    required: true,
    example: "tomasz.nowak@example.com",
    help: "How this person signs in. Must not already be in use anywhere on the platform.",
  },
  {
    key: "phone",
    header: "Phone Number",
    aliases: PHONE_ALIASES,
    type: "phone",
    required: true,
    example: "07700 900321",
  },
  {
    key: "employeId",
    header: "Employee ID",
    aliases: ["Staff ID", "Payroll Number", "Employee Number", "Emp No", "Ref"],
    type: "text",
    example: "SITE-014",
  },
  {
    key: "dateOfBirth",
    header: "Date of Birth",
    aliases: ["DOB", "Birth Date", "Birthday", "D.O.B"],
    type: "date",
    example: "02/02/1988",
  },
  {
    key: "employeRole",
    header: "Job Role",
    aliases: ["Role", "Trade", "Position", "Job Title", "Occupation"],
    type: "text",
    required: true,
    example: "Carpenter",
  },
  {
    key: "paymentType",
    header: "Payment Type",
    aliases: ["Payroll Type", "Paid", "Pay Group"],
    type: "choice",
    required: true,
    options: [
      { value: "Weekly", aliases: ["CIS", "Subcontractor", "Sub-contractor"] },
      { value: "Monthly", aliases: ["Payroll", "PAYE", "Salaried"] },
    ],
    example: "Weekly",
    help: "Weekly is CIS; Monthly is payroll. This decides which the record is filed as.",
  },
  {
    key: "cisDeduction",
    header: "CIS Deduction %",
    aliases: ["CIS", "CIS Rate", "CIS %", "Deduction"],
    type: "number",
    example: "20",
    default: 0,
    help: "20 or 30 for CIS subcontractors. Leave blank for payroll staff.",
  },
  {
    key: "utr",
    header: "UTR",
    aliases: ["UTR Number", "Tax Reference", "Unique Taxpayer Reference"],
    type: "digits",
    example: "",
  },
  {
    key: "payType",
    header: "Pay Type",
    aliases: ["Pay Frequency", "Rate Type", "Pay Basis"],
    type: "choice",
    required: true,
    options: [
      { value: "Hourly", aliases: ["Per Hour", "Hour"] },
      { value: "Daily", aliases: ["Per Day", "Day Rate", "Day"] },
      { value: "Weekly", aliases: ["Per Week", "Week"] },
      { value: "Fortnightly", aliases: ["Bi-Weekly", "Biweekly", "Two Weekly"] },
      { value: "Monthly", aliases: ["Per Month", "Month"] },
      { value: "Yearly", aliases: ["Annually", "Annual", "Per Annum", "Salary"] },
    ],
    example: "Hourly",
  },
  {
    key: "payRate",
    header: "Pay Rate",
    aliases: ["Rate", "Hourly Rate", "Rate of Pay", "Salary", "Day Rate"],
    type: "number",
    required: true,
    example: "18.50",
  },
  {
    key: "startDate",
    header: "Start Date",
    aliases: [
      "Join Date",
      "Date Joined",
      "Hire Date",
      "Employment Start Date",
      "Commencement Date",
      "Started",
    ],
    type: "date",
    required: true,
    example: "03/06/2024",
  },
  {
    key: "endDate",
    header: "End Date",
    aliases: ["Leave Date", "Leaving Date", "Termination Date", "Last Day"],
    type: "date",
    example: "",
    help: "Leave blank for current staff.",
  },
  {
    key: "immigrationType",
    header: "Immigration Type",
    aliases: ["Right to Work", "Nationality Status", "Immigration Status"],
    type: "choice",
    required: true,
    options: IMMIGRATION_OPTIONS,
    default: "British",
    example: "Immigrant",
  },
  {
    key: "immigrationCategory",
    header: "Immigration Category",
    aliases: ["Visa Type", "Visa Category"],
    type: "text",
    example: "Skilled Worker",
  },
  {
    key: "visaStartDate",
    header: "Visa Start Date",
    aliases: ["Visa From"],
    type: "date",
    example: "01/05/2024",
  },
  {
    key: "eVisaExp",
    header: "Visa End Date",
    aliases: ["Visa Expiry", "Visa Expiry Date", "Visa To", "Visa Exp", "eVisaExp"],
    type: "date",
    example: "01/05/2027",
  },
  ...SHARED_TAIL,
];

export const COLUMNS = { office: OFFICE_COLUMNS, site: SITE_COLUMNS };

/** The column list for a kind, or office if somebody passes nonsense. */
export function columnsFor(kind) {
  return COLUMNS[kind] || COLUMNS.office;
}

/**
 * Columns that must have a value, but whose absence should not stop a
 * migration.
 *
 * The schemas mark these required because the *forms* ask for them, and a form
 * is filled in by somebody sitting with the employee. A file exported from the
 * system a company is leaving frequently does not carry them — older records
 * especially — and refusing the whole row over a missing next-of-kin would mean
 * the migration cannot happen at all. So the row is imported with a value that
 * says plainly that it is missing, and the row is listed under warnings so
 * somebody can go and fill it in.
 *
 * Deliberately a short list. Nothing that decides pay, identity or right to
 * work is on it: a missing pay rate is a real error and stays one.
 */
const SOFT_REQUIRED = {
  site: {
    address: "Not provided",
    postCode: "Not provided",
    emergencyName: "Not provided",
    employeRole: "Not provided",
  },
  office: {},
};

/* -------------------------------------------------------------------------- */
/* Headers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Work out which column of the file is which field.
 *
 * Matching is on the header text with case, spaces and punctuation removed, so
 * "Date of Birth", "date_of_birth" and "DATEOFBIRTH" all land on the same
 * field. A header that matches nothing is returned in `ignored` rather than
 * being guessed at — see the whitelist note at the top of this file.
 *
 * @returns {{
 *   byKey: Record<string, number>,
 *   matched: { key: string, header: string, found: string }[],
 *   ignored: string[],
 *   missingRequired: { key: string, header: string }[],
 *   duplicated: string[],
 * }}
 */
export function matchHeaders(headers, kind) {
  const columns = columnsFor(kind);

  // Every accepted spelling, pointing at its field.
  const lookup = new Map();
  for (const column of columns) {
    lookup.set(slugify(column.header), column.key);
    lookup.set(slugify(column.key), column.key);
    for (const alias of column.aliases || []) {
      // A column's own header always wins over another column's alias.
      if (!lookup.has(slugify(alias))) lookup.set(slugify(alias), column.key);
    }
  }
  // Re-assert the real headers, in case an alias above shadowed one.
  for (const column of columns) lookup.set(slugify(column.header), column.key);

  const byKey = {};
  const matched = [];
  const ignored = [];
  const duplicated = [];

  headers.forEach((header, index) => {
    const key = lookup.get(slugify(header));
    if (!key) {
      if (cleanText(header)) ignored.push(header);
      return;
    }
    if (byKey[key] !== undefined) {
      duplicated.push(header);
      return;
    }
    byKey[key] = index;
    const column = columns.find((c) => c.key === key);
    matched.push({ key, header: column.header, found: header });
  });

  const missingRequired = columns
    .filter((column) => column.required && byKey[column.key] === undefined)
    .map((column) => ({ key: column.key, header: column.header }));

  return { byKey, matched, ignored, missingRequired, duplicated };
}

/* -------------------------------------------------------------------------- */
/* Template                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A blank file with the right headers and one worked example.
 *
 * The example row exists to answer the two questions a blank template cannot:
 * what a date is supposed to look like, and what the allowed words are for the
 * choice columns. Whoever fills it in deletes that row.
 */
export function templateCsv(kind) {
  const columns = columnsFor(kind);
  const headers = columns.map((column) => column.header);
  const example = columns.map((column) => column.example ?? "");
  return toCsv(headers, [example]);
}

/** Human-readable column reference for the on-screen guide. */
export function describeColumns(kind) {
  return columnsFor(kind).map((column) => ({
    header: column.header,
    key: column.key,
    required: Boolean(column.required),
    softRequired: Boolean(SOFT_REQUIRED[kind]?.[column.key]),
    sensitive: Boolean(column.sensitive),
    accepts:
      column.type === "choice"
        ? column.options.map((option) => option.value).join(" / ")
        : column.type === "date"
          ? "date"
          : column.type === "lookup"
            ? "existing department name"
            : column.type,
    help: column.help || "",
  }));
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

const NI_PATTERN = /^[A-Z]{2}\d{6}[A-Z]$/i;

/**
 * One line of the file, read into the fields of a record.
 *
 * Knows nothing about the database — no duplicate checking and no department
 * lookup happen here, only "is this cell a date / a number / one of the allowed
 * words". The server layer adds everything that needs to ask Mongo.
 *
 * Errors stop the row being imported. Warnings do not: they are things worth
 * telling somebody about that are not worth losing an employee over.
 *
 * @returns {{ values: Record<string, any>, errors: string[], warnings: string[] }}
 */
export function coerceRow(kind, cells, byKey, { dateOrder = "DMY" } = {}) {
  const columns = columnsFor(kind);
  const soft = SOFT_REQUIRED[kind] || {};
  const values = {};
  const errors = [];
  const warnings = [];

  const raw = (key) => {
    const index = byKey[key];
    return index === undefined ? "" : (cells[index] ?? "");
  };

  for (const column of columns) {
    const cell = raw(column.key);
    const label = column.header;

    if (isBlank(cell)) {
      if (column.default !== undefined) values[column.key] = column.default;
      if (column.required) {
        if (soft[column.key] !== undefined) {
          values[column.key] = soft[column.key];
          warnings.push(`${label} is empty — imported as "${soft[column.key]}"`);
        } else {
          errors.push(`${label} is required`);
        }
      } else if (soft[column.key] !== undefined) {
        values[column.key] = soft[column.key];
        warnings.push(`${label} is empty — imported as "${soft[column.key]}"`);
      }
      continue;
    }

    switch (column.type) {
      case "email": {
        const email = emailKey(cell);
        if (!isValidEmail(email)) {
          errors.push(`${label} "${cleanText(cell)}" is not a valid email address`);
        } else {
          values[column.key] = email;
        }
        break;
      }

      case "phone": {
        const key = phoneKey(cell);
        if (!key) {
          if (column.required) errors.push(`${label} has no digits in it`);
          break;
        }
        if (!isPlausiblePhone(cell)) {
          warnings.push(
            `${label} "${cleanText(cell)}" is an unusual length for a UK number`
          );
        }
        values[column.key] = Number(key);
        break;
      }

      case "date": {
        const date = parseFlexibleDate(cell, dateOrder);
        if (!date) {
          const message = `${label} "${cleanText(cell)}" is not a date we can read`;
          if (column.required) errors.push(message);
          else warnings.push(`${message} — left empty`);
          break;
        }
        values[column.key] = date;
        break;
      }

      case "number": {
        const number = parseNumber(cell);
        if (number === null) {
          const message = `${label} "${cleanText(cell)}" is not a number`;
          if (column.required) errors.push(message);
          else warnings.push(`${message} — left empty`);
          break;
        }
        values[column.key] = number;
        break;
      }

      case "digits": {
        // Account numbers, sort codes and UTRs: strip the formatting people put
        // in them. Stored as Numbers by the schemas, which is why a sort code
        // of "20-00-00" ends up as 200000.
        const digits = cleanText(cell).replace(/[^\d]/g, "");
        if (!digits) {
          warnings.push(`${label} "${cleanText(cell)}" has no digits — left empty`);
          break;
        }
        values[column.key] = Number(digits);
        break;
      }

      case "ni": {
        const ni = cleanText(cell).replace(/\s/g, "").toUpperCase();
        if (!NI_PATTERN.test(ni)) {
          warnings.push(
            `NI Number "${cleanText(cell)}" is not in the format XX123456X — imported as written`
          );
        }
        values[column.key] = ni;
        break;
      }

      case "choice": {
        const choice = parseChoice(cell, column.options);
        if (!choice) {
          const allowed = column.options.map((o) => o.value).join(", ");
          const message = `${label} "${cleanText(cell)}" is not one of: ${allowed}`;
          if (column.required && column.default === undefined) {
            errors.push(message);
          } else {
            values[column.key] = column.default;
            warnings.push(`${message} — used "${column.default}"`);
          }
          break;
        }
        values[column.key] = choice;
        break;
      }

      case "lookup":
        // Resolved against the database by the server; kept as written here.
        values[column.key] = cleanText(cell);
        break;

      default:
        values[column.key] = cleanText(cell);
    }
  }

  applyKindRules(kind, values, errors, warnings);

  return { values, errors, warnings };
}

/**
 * The handful of rules that are about a record rather than a cell.
 *
 * Each one exists because the schema or a downstream screen would otherwise
 * fail later, at a point where the failure is much harder to explain than it is
 * here.
 */
function applyKindRules(kind, values, errors, warnings) {
  // A visa that is already spent means a record we are keeping for the file
  // rather than somebody about to start. Both create paths in this codebase
  // treat that as "do not send them a welcome email"; the import follows suit,
  // and says so rather than leaving it to be discovered.
  const visaEnd = kind === "site" ? values.eVisaExp : values.visaEndDate;
  if (visaEnd instanceof Date && visaEnd < new Date()) {
    warnings.push("Visa end date is in the past — no welcome email will be sent");
  }

  if (values.endDate instanceof Date) {
    const start = kind === "site" ? values.startDate : values.joinDate;
    if (start instanceof Date && values.endDate < start) {
      errors.push("End Date is before the start date");
    }
  }

  if (values.dateOfBirth instanceof Date) {
    const age =
      (Date.now() - values.dateOfBirth.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (age < 14 || age > 100) {
      warnings.push(
        `Date of Birth gives an age of ${Math.floor(age)} — check the date format`
      );
    }
  }

  if (kind === "office") {
    if (values.weeklyHourType === "custom" && !values.weeklyHours) {
      errors.push('Weekly Hours Type is "custom" but Hours Per Week is empty');
    }
    if (values.dayPerWeek !== undefined) {
      if (values.dayPerWeek < 1 || values.dayPerWeek > 7) {
        errors.push("Days Per Week must be between 1 and 7");
      }
    }
    if (values.immigrationType === "Immigrant" && !values.visaEndDate) {
      warnings.push("Immigration Type is Immigrant but no Visa End Date was given");
    }
  }

  if (kind === "site") {
    if (values.payRate !== undefined && values.payRate <= 0) {
      errors.push("Pay Rate must be more than zero");
    }
    if (
      values.cisDeduction !== undefined &&
      ![0, 20, 30].includes(values.cisDeduction)
    ) {
      warnings.push(
        `CIS Deduction % of ${values.cisDeduction} is neither 20 nor 30 — imported as written`
      );
    }
    if (values.immigrationType === "Immigrant" && !values.eVisaExp) {
      warnings.push("Immigration Type is Immigrant but no Visa End Date was given");
    }
  }

  // Bank details are one thing, not four. The site employee schema requires an
  // account name, number and sort code together, so a partial set would throw
  // on save — dropped here instead, with a note.
  const bankFields = [values.accountName, values.accountNumber, values.sortCode];
  const given = bankFields.filter((v) => v !== undefined && v !== "").length;
  if (given > 0 && given < 3) {
    warnings.push(
      "Bank details are incomplete (account name, number and sort code are needed together) — not imported"
    );
    delete values.accountName;
    delete values.accountNumber;
    delete values.sortCode;
    delete values.bankName;
  }
}

/** The name to show for a row in the preview. */
export function rowLabel(kind, values) {
  if (kind === "site") {
    return cleanText(`${values.firstName || ""} ${values.lastName || ""}`) || "—";
  }
  return values.name || "—";
}
