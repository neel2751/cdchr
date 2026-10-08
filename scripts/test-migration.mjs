/**
 * The staff-import reader: CSV parsing, normalisation and row validation.
 *
 * Pure — no database, no session. Everything here is the half of the import
 * that decides whether two rows describe the same person, which is the half
 * that must not be wrong: a loose email or phone comparison lets a bulk import
 * create a second sign-in for somebody who already has one, and the login
 * lookup searches every collection in every tenant (see
 * server/authServer/authServer.js).
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-migration.mjs
 */
import assert from "node:assert";

import { detectDelimiter, parseCsv, toCsv } from "@/lib/csv";
import {
  cleanText,
  emailKey,
  isBlank,
  isPlausiblePhone,
  isValidEmail,
  parseBoolean,
  parseChoice,
  parseFlexibleDate,
  parseNumber,
  phoneKey,
} from "@/lib/migration/normalize";
import {
  coerceRow,
  columnsFor,
  matchHeaders,
  rowLabel,
  templateCsv,
} from "@/lib/migration/columns";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

check("a quoted field may contain the delimiter", () => {
  const { headers, rows } = parseCsv('Name,Address\n"Smith, John","12 Mill Lane, Hulme"');
  assert.deepEqual(headers, ["Name", "Address"]);
  assert.deepEqual(rows[0].cells, ["Smith, John", "12 Mill Lane, Hulme"]);
});

check("a quoted field may contain a newline and an escaped quote", () => {
  const { rows } = parseCsv('A,B\n"line one\nline two","say ""hi"""');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cells[0], "line one\nline two");
  assert.equal(rows[0].cells[1], 'say "hi"');
});

check("Excel's BOM and CRLF do not leak into the first header", () => {
  const { headers, rows } = parseCsv("﻿Email Address,Name\r\na@b.com,Ann\r\n");
  assert.equal(headers[0], "Email Address");
  assert.equal(rows.length, 1);
});

check("a semicolon file is not read as one giant column", () => {
  assert.equal(detectDelimiter("Name;Email;Phone"), ";");
  const { headers } = parseCsv("Name;Email;Phone\nAnn;a@b.com;07700900123");
  assert.deepEqual(headers, ["Name", "Email", "Phone"]);
});

check("a comma inside a quoted header does not choose the delimiter", () => {
  assert.equal(detectDelimiter('"Name, Full";Email;Phone'), ";");
});

check("trailing blank lines are dropped, blank rows are not", () => {
  const { rows } = parseCsv("A,B\n1,2\n\n\n");
  assert.equal(rows.length, 1);
  const withEmptyRow = parseCsv("A,B\n1,2\n,\n");
  assert.equal(withEmptyRow.rows.length, 2);
});

check("line numbers point at the line in the file", () => {
  const { rows } = parseCsv("A\n1\n2\n3");
  assert.deepEqual(rows.map((r) => r.line), [2, 3, 4]);
});

check("writing then reading a value gives the value back", () => {
  const csv = toCsv(["A", "B"], [['say "hi", twice', "plain"]]);
  const { rows } = parseCsv(csv);
  assert.equal(rows[0].cells[0], 'say "hi", twice');
  assert.equal(rows[0].cells[1], "plain");
});

/* -------------------------------------------------------------------------- */
/* Email — the credential                                                      */
/* -------------------------------------------------------------------------- */

check("EMAIL COMPARISON IGNORES CASE AND SURROUNDING SPACE", () => {
  // Office emails have been lower-cased on write for years; site employee
  // emails never have. The same person is therefore on file in two casings
  // depending on which list they are on, and a case-sensitive comparison would
  // call them two different people and create a second sign-in.
  assert.equal(emailKey("  J.Smith@Acme.CO.uk "), "j.smith@acme.co.uk");
  assert.equal(emailKey("J.SMITH@ACME.CO.UK"), emailKey("j.smith@acme.co.uk"));
});

check("a display-name email is reduced to the address", () => {
  assert.equal(emailKey("Ann Jones <ann@acme.com>"), "ann@acme.com");
});

check("rubbish is not accepted as an email", () => {
  assert.equal(isValidEmail("ann@acme.com"), true);
  assert.equal(isValidEmail("ann@acme"), false);
  assert.equal(isValidEmail("ann.acme.com"), false);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail("   "), false);
});

/* -------------------------------------------------------------------------- */
/* Phone                                                                       */
/* -------------------------------------------------------------------------- */

check("ONE UK NUMBER WRITTEN SIX WAYS IS ONE NUMBER", () => {
  // Both schemas store the phone as a Number, so the leading zero is already
  // gone from every record on disk. Matching has to be done in that same form.
  const expected = "7700900123";
  for (const written of [
    "07700 900123",
    "07700900123",
    "+44 7700 900123",
    "+447700900123",
    "0044 7700 900123",
    "(07700) 900-123",
  ]) {
    assert.equal(phoneKey(written), expected, `for ${written}`);
  }
});

check("a landline keeps its digits", () => {
  assert.equal(phoneKey("0161 496 0123"), "1614960123");
});

check("a blank phone is not a number two blanks can match on", () => {
  assert.equal(phoneKey(""), "");
  assert.equal(phoneKey("   "), "");
  assert.equal(phoneKey("-"), "");
  assert.equal(phoneKey("n/a"), "");
});

check("an implausible length is noticed", () => {
  assert.equal(isPlausiblePhone("07700900123"), true);
  assert.equal(isPlausiblePhone("123"), false);
});

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

const iso = (date) => (date ? date.toISOString().slice(0, 10) : null);

check("day-first and month-first are both readable, when told which", () => {
  assert.equal(iso(parseFlexibleDate("03/04/2024", "DMY")), "2024-04-03");
  assert.equal(iso(parseFlexibleDate("03/04/2024", "MDY")), "2024-03-04");
});

check("AN UNAMBIGUOUS DATE IS READ CORRECTLY UNDER EITHER SETTING", () => {
  // A day above 12 cannot be a month, whatever the dropdown says. Getting this
  // wrong silently moves somebody's start date by months.
  assert.equal(iso(parseFlexibleDate("31/12/2024", "MDY")), "2024-12-31");
  assert.equal(iso(parseFlexibleDate("2024-12-31", "MDY")), "2024-12-31");
});

check("the formats other systems export are all read", () => {
  assert.equal(iso(parseFlexibleDate("2024-06-03")), "2024-06-03");
  assert.equal(iso(parseFlexibleDate("3-6-2024")), "2024-06-03");
  assert.equal(iso(parseFlexibleDate("3.6.2024")), "2024-06-03");
  assert.equal(iso(parseFlexibleDate("3 Jun 2024")), "2024-06-03");
  assert.equal(iso(parseFlexibleDate("June 3, 2024")), "2024-06-03");
  assert.equal(iso(parseFlexibleDate("2024-06-03T09:00:00Z")), "2024-06-03");
});

check("an Excel serial date is a date, not a number", () => {
  // 45446 is how Excel writes 2024-06-03 when the column was formatted as a
  // date and exported as a number.
  assert.equal(iso(parseFlexibleDate("45446")), "2024-06-03");
});

check("a two-digit year lands in the right century", () => {
  // A date of birth is never in the future; a start date is never a decade out.
  assert.equal(iso(parseFlexibleDate("14/07/90")), "1990-07-14");
  assert.equal(iso(parseFlexibleDate("01/04/23")), "2023-04-01");
});

check("an impossible date is rejected rather than rolled forward", () => {
  assert.equal(parseFlexibleDate("31/02/2024"), null);
  assert.equal(parseFlexibleDate("not a date"), null);
  assert.equal(parseFlexibleDate(""), null);
});

check("dates land at midnight UTC so they do not drift a day", () => {
  const date = parseFlexibleDate("03/04/2024");
  assert.equal(date.getUTCHours(), 0);
  assert.equal(date.getUTCMinutes(), 0);
});

/* -------------------------------------------------------------------------- */
/* Numbers, choices, blanks                                                    */
/* -------------------------------------------------------------------------- */

check("a decorated number is still a number", () => {
  assert.equal(parseNumber("£18.50"), 18.5);
  assert.equal(parseNumber("1,250"), 1250);
  assert.equal(parseNumber("20%"), 20);
  assert.equal(parseNumber("(12.50)"), -12.5);
  assert.equal(parseNumber("abc"), null);
});

check("a choice is matched past case and punctuation, but not past meaning", () => {
  const options = [{ value: "Full-Time", aliases: ["Permanent"] }, { value: "Part-Time" }];
  assert.equal(parseChoice("full time", options), "Full-Time");
  assert.equal(parseChoice("FULLTIME", options), "Full-Time");
  assert.equal(parseChoice("Permanent", options), "Full-Time");
  assert.equal(parseChoice("Casual", options), null);
});

check("the words a spreadsheet uses for nothing count as nothing", () => {
  for (const nothing of ["", "  ", "-", "N/A", "null", "none"]) {
    assert.equal(isBlank(nothing), true, `for "${nothing}"`);
  }
  assert.equal(isBlank("0"), false);
});

check("yes and no are booleans", () => {
  assert.equal(parseBoolean("Yes"), true);
  assert.equal(parseBoolean("FALSE"), false);
  assert.equal(parseBoolean("maybe"), null);
});

check("invisible whitespace from a spreadsheet is collapsed", () => {
  assert.equal(cleanText("John  Smith "), "John Smith");
});

/* -------------------------------------------------------------------------- */
/* Header matching                                                             */
/* -------------------------------------------------------------------------- */

check("another system's column names are recognised", () => {
  const { byKey, ignored, missingRequired } = matchHeaders(
    [
      "Forename",
      "Surname",
      "E-mail",
      "Mobile Number",
      "Job Role",
      "Payroll Type",
      "Pay Frequency",
      "Hourly Rate",
      "Date Joined",
      "Immigration Status",
    ],
    "site"
  );
  assert.equal(byKey.firstName, 0);
  assert.equal(byKey.lastName, 1);
  assert.equal(byKey.email, 2);
  assert.equal(byKey.phone, 3);
  assert.equal(byKey.employeRole, 4);
  assert.equal(byKey.paymentType, 5);
  assert.equal(byKey.payType, 6);
  assert.equal(byKey.payRate, 7);
  assert.equal(byKey.startDate, 8);
  assert.equal(byKey.immigrationType, 9);
  assert.deepEqual(ignored, []);
  assert.deepEqual(missingRequired, []);
});

check("casing, spaces and underscores in a header do not matter", () => {
  const { byKey } = matchHeaders(["  full_name ", "EMAIL ADDRESS"], "office");
  assert.equal(byKey.name, 0);
  assert.equal(byKey.email, 1);
});

check("A COLUMN WE DO NOT KNOW IS IGNORED, NOT GUESSED AT", () => {
  // The column list is a whitelist, and that is a security boundary: isAdmin,
  // isSuperAdmin, password and tenantId are all real fields on these schemas.
  const { byKey, ignored } = matchHeaders(
    ["Full Name", "isSuperAdmin", "password", "tenantId", "Favourite Colour"],
    "office"
  );
  assert.equal(byKey.isSuperAdmin, undefined);
  assert.equal(byKey.password, undefined);
  assert.equal(byKey.tenantId, undefined);
  assert.equal(ignored.length, 4);
});

check("a missing required column is named, not discovered row by row", () => {
  const { missingRequired } = matchHeaders(["Full Name", "Phone Number"], "office");
  const missing = missingRequired.map((c) => c.key);
  assert.ok(missing.includes("email"));
  assert.ok(missing.includes("department"));
});

check("the same field appearing twice uses the first and says so", () => {
  const { byKey, duplicated } = matchHeaders(["Email", "E-mail"], "site");
  assert.equal(byKey.email, 0);
  assert.equal(duplicated.length, 1);
});

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

/** Build a row from an object keyed by column header. */
function readRow(kind, record) {
  const headers = Object.keys(record);
  const { byKey } = matchHeaders(headers, kind);
  return coerceRow(kind, Object.values(record), byKey, { dateOrder: "DMY" });
}

const SITE_ROW = {
  "First Name": "Tomasz",
  "Last Name": "Nowak",
  "Email Address": "Tomasz.Nowak@example.com",
  "Phone Number": "07700 900321",
  "Job Role": "Carpenter",
  "Payment Type": "Weekly",
  "Pay Type": "Hourly",
  "Pay Rate": "£18.50",
  "Start Date": "03/06/2024",
  "Immigration Type": "British",
  "Address Line 1": "12 Mill Lane",
  Postcode: "M15 5FQ",
  "Emergency Contact Name": "Sara Nowak",
};

check("a complete site row reads into the fields the schema wants", () => {
  const { values, errors } = readRow("site", SITE_ROW);
  assert.deepEqual(errors, []);
  assert.equal(values.email, "tomasz.nowak@example.com");
  assert.equal(values.phone, 7700900321);
  assert.equal(values.payRate, 18.5);
  assert.equal(values.payType, "Hourly");
  assert.equal(iso(values.startDate), "2024-06-03");
  assert.equal(rowLabel("site", values), "Tomasz Nowak");
});

check("a missing pay rate is an error, not a guess", () => {
  const { errors } = readRow("site", { ...SITE_ROW, "Pay Rate": "" });
  assert.ok(errors.some((e) => e.includes("Pay Rate")));
});

check("a missing next of kin is filled in and flagged, not refused", () => {
  // Schema-required, but routinely absent from an old system's export. Losing
  // the employee over it would mean the migration cannot happen at all.
  const { values, errors, warnings } = readRow("site", {
    ...SITE_ROW,
    "Emergency Contact Name": "",
  });
  assert.deepEqual(errors, []);
  assert.equal(values.emergencyName, "Not provided");
  assert.ok(warnings.some((w) => w.includes("Emergency Contact Name")));
});

check("an unreadable email stops the row", () => {
  const { errors } = readRow("site", { ...SITE_ROW, "Email Address": "nope" });
  assert.ok(errors.some((e) => e.includes("valid email")));
});

check("an end date before the start date is an error", () => {
  const { errors } = readRow("site", { ...SITE_ROW, "End Date": "01/01/2020" });
  assert.ok(errors.some((e) => e.includes("End Date")));
});

check("BANK DETAILS ARE ALL OR NOTHING", () => {
  // The site employee schema requires account name, number and sort code
  // together, so a partial set throws on save — after other rows have been
  // written.
  const { values, warnings } = readRow("site", {
    ...SITE_ROW,
    "Bank Account Name": "T Nowak",
    "Sort Code": "20-00-00",
  });
  assert.equal(values.accountName, undefined);
  assert.equal(values.sortCode, undefined);
  assert.ok(warnings.some((w) => w.includes("Bank details")));
});

check("a complete set of bank details survives, with the formatting stripped", () => {
  const { values } = readRow("site", {
    ...SITE_ROW,
    "Bank Account Name": "T Nowak",
    "Bank Account Number": "12345678",
    "Sort Code": "20-00-00",
  });
  assert.equal(values.accountNumber, 12345678);
  assert.equal(values.sortCode, 200000);
});

const OFFICE_ROW = {
  "Full Name": "Anita Patel",
  "Email Address": "anita.patel@example.com",
  "Phone Number": "07700 900123",
  Department: "Operations",
  "Job Title": "Operations Manager",
  "Employment Type": "Full-Time",
  "Start Date": "01/04/2023",
  "Immigration Type": "British",
};

check("a complete office row reads, with the sensible defaults filled in", () => {
  const { values, errors } = readRow("office", OFFICE_ROW);
  assert.deepEqual(errors, []);
  assert.equal(values.dayPerWeek, 5);
  assert.equal(values.weeklyHourType, "fixed");
  assert.equal(values.department, "Operations");
});

check("custom weekly hours without a figure is an error", () => {
  const { errors } = readRow("office", {
    ...OFFICE_ROW,
    "Weekly Hours Type": "custom",
  });
  assert.ok(errors.some((e) => e.includes("Hours Per Week")));
});

check("days per week outside 1-7 is an error", () => {
  const { errors } = readRow("office", { ...OFFICE_ROW, "Days Per Week": "9" });
  assert.ok(errors.some((e) => e.includes("Days Per Week")));
});

check("an unreadable employment type is refused with the allowed words", () => {
  const { errors } = readRow("office", {
    ...OFFICE_ROW,
    "Employment Type": "Zero Hours",
  });
  assert.ok(errors.some((e) => e.includes("Full-Time")));
});

check("an immigration type we cannot read falls back and says so", () => {
  const { values, warnings } = readRow("office", {
    ...OFFICE_ROW,
    "Immigration Type": "Martian",
  });
  assert.equal(values.immigrationType, "British");
  assert.ok(warnings.some((w) => w.includes("Immigration Type")));
});

check("an expired visa warns that no welcome email will go out", () => {
  const { warnings } = readRow("site", {
    ...SITE_ROW,
    "Immigration Type": "Immigrant",
    "Visa End Date": "01/01/2020",
  });
  assert.ok(warnings.some((w) => w.includes("welcome email")));
});

check("a date of birth read in the wrong order gives an absurd age", () => {
  const { warnings } = readRow("site", {
    ...SITE_ROW,
    "Date of Birth": "01/01/2024",
  });
  assert.ok(warnings.some((w) => w.includes("age")));
});

/* -------------------------------------------------------------------------- */
/* The template                                                                */
/* -------------------------------------------------------------------------- */

check("THE TEMPLATE ROUND-TRIPS THROUGH THE IMPORT IT IS FOR", () => {
  // The single most likely thing anybody uploads is the template with the rows
  // changed. If its own example row does not import, nothing else will.
  for (const kind of ["office", "site"]) {
    const { headers, rows } = parseCsv(templateCsv(kind));
    const report = matchHeaders(headers, kind);
    assert.deepEqual(report.missingRequired, [], `${kind} missing columns`);
    assert.deepEqual(report.ignored, [], `${kind} unrecognised columns`);
    assert.equal(headers.length, columnsFor(kind).length);

    const { errors } = coerceRow(kind, rows[0].cells, report.byKey, {
      dateOrder: "DMY",
    });
    assert.deepEqual(errors, [], `${kind} example row: ${errors.join("; ")}`);
  }
});

/* -------------------------------------------------------------------------- */

let failures = 0;
for (const [status, name] of results) {
  if (status === "FAIL") failures++;
  console.log(`${status === "pass" ? "✓" : "✗"} ${name}`);
}
console.log(
  `\n${results.length - failures}/${results.length} passed${failures ? ` — ${failures} FAILED` : ""}`
);
process.exitCode = failures ? 1 : 0;
