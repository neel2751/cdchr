/**
 * CSV in and out.
 *
 * Written out rather than pulled from npm because the screens that export CSV
 * (leave, attendance, audit, leads) each hand-rolled the *writing* half already,
 * and the only new requirement is a parser that survives what a real payroll
 * export looks like: quoted fields containing commas and newlines, a UTF-8 BOM
 * from Excel, CRLF line endings, and — on a European Excel — semicolons instead
 * of commas.
 *
 * Nothing here knows about employees. lib/migration/columns.js turns these rows
 * into records.
 */

const BOM = "﻿";

/** Strip a leading byte-order mark, and only a leading one. */
const stripBom = (text) => (text.startsWith(BOM) ? text.slice(1) : text);

/**
 * Which character separates the fields.
 *
 * Excel writes the list separator of the machine it was saved on, so a file
 * from a German or French office is semicolon-delimited and would otherwise
 * parse as one enormous column. Decided from the first line only, and outside
 * quotes, so a comma inside "Smith, John" does not cast a vote.
 */
export function detectDelimiter(text) {
  const firstLine = stripBom(String(text || "")).split(/\r?\n/, 1)[0];

  let best = ",";
  let bestCount = 0;
  for (const candidate of [",", ";", "\t", "|"]) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === candidate && !inQuotes) {
        count++;
      }
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Every row of the file, as arrays of strings.
 *
 * A state machine rather than `split(",")`: a split cannot tell a separator
 * from a comma inside a quoted address, and an address with a comma in it is
 * the first thing any real export contains.
 *
 * Blank lines are dropped — trailing ones especially, since almost every file
 * ends with a newline — but a line of empty *fields* (",,,") is kept, because
 * that is a row somebody forgot to fill in and they should be told so rather
 * than have it vanish.
 *
 * @param {string} text
 * @param {{ delimiter?: string }} [options]
 * @returns {string[][]}
 */
export function parseCsvRows(text, { delimiter } = {}) {
  const input = stripBom(String(text || ""));
  const sep = delimiter || detectDelimiter(input);

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  // Distinguishes an empty line from a line whose fields are all empty.
  let started = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A single empty field is an empty line, not a row.
    if (started || row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      started = true;
    } else if (ch === sep) {
      started = true;
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      // Swallowed: CRLF ends the row on the \n.
    } else {
      if (ch.trim() !== "") started = true;
      field += ch;
    }
  }

  // Whatever is left when the file runs out, unless it ran out on a newline.
  if (started || field !== "" || row.length) endRow();

  return rows;
}

/**
 * Header row plus body, with the headers trimmed.
 *
 * `line` is the 1-based line number in the original file including the header,
 * so an error can say "line 14" and the person can go and look at line 14.
 *
 * @returns {{ headers: string[], rows: { line: number, cells: string[] }[], delimiter: string }}
 */
export function parseCsv(text, options = {}) {
  const delimiter = options.delimiter || detectDelimiter(text);
  const all = parseCsvRows(text, { delimiter });
  if (!all.length) return { headers: [], rows: [], delimiter };

  const headers = all[0].map((h) => h.trim());
  const rows = all.slice(1).map((cells, index) => ({
    line: index + 2,
    cells,
  }));
  return { headers, rows, delimiter };
}

/** One value, quoted only when it has to be. */
function escapeCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // A leading separator-looking character, a quote or a newline all need quoting.
  if (/[",;\t\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Rows to a CSV string, BOM included.
 *
 * The BOM is deliberate: without it Excel opens a UTF-8 file as the local
 * codepage, and every name with an accent in it arrives mangled — which on a
 * template people fill in and send back means the mangling comes home to us.
 *
 * @param {string[]} headers
 * @param {Array<Array<any>|Record<string, any>>} rows array-rows, or objects keyed by header
 */
export function toCsv(headers, rows = []) {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    const cells = Array.isArray(row)
      ? row
      : headers.map((h) => row?.[h] ?? "");
    lines.push(cells.map(escapeCell).join(","));
  }
  return BOM + lines.join("\r\n");
}
