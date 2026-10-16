/**
 * Does every server component actually await its route parameters?
 *
 * WHY THIS IS WORTH A SCRIPT. Since Next 15 `params` and `searchParams` are
 * Promises, and reading one synchronously is not an error — it is a property
 * lookup on a Promise object, which yields `undefined`. No throw, no warning,
 * no build failure, nothing in the console. The page renders; the values are
 * simply gone.
 *
 * On 2026-10-16 that silently broke every new employee's first login.
 * app/reset-password/page.jsx read `searchParams?.uid` and `searchParams?.token`
 * without awaiting, so the form received two empty strings, decided the link
 * was malformed, and told people to request a new one. Requesting a new one
 * worked flawlessly and returned them to the same page, so it read as two
 * separate faults and neither of them was where anybody was looking.
 *
 * The failure mode is what makes it worth automating: a page that quietly drops
 * its own inputs looks identical to a page whose inputs were never sent.
 *
 *   npm run audit:async-params
 *
 * Exits non-zero if anything is wrong, so CI can hold the line.
 */
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "app");
const PROPS = ["params", "searchParams"];

/** Every page, layout and route handler under app/. */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (/^(page|layout|route|default|error|not-found)\.(js|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// The signatures that receive route parameters from Next. Route handlers take
// them as a SECOND argument, which is why the pattern allows anything before
// the destructuring.
const SIGNATURES = [
  /export\s+default\s+(async\s+)?function\s*\w*\s*\(\s*\{([^}]*)\}/,
  /export\s+(async\s+)?function\s+generateMetadata\s*\(\s*\{([^}]*)\}/,
  /export\s+(async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\([^)]*?\{([^}]*)\}\s*\)/,
];

const findings = [];

for (const file of (await walk(ROOT)).sort()) {
  const source = readFileSync(file, "utf8");
  const rel = path.relative(process.cwd(), file);

  // A client component never receives these as props — it reads them with
  // useSearchParams/useParams, which are not promises.
  if (/^\s*["']use client["']/m.test(source)) continue;

  for (const pattern of SIGNATURES) {
    const match = source.match(pattern);
    if (!match) continue;

    const isAsync = Boolean(match[1]);
    const destructured = match[match.length - 1];

    for (const prop of PROPS) {
      // Word-boundaried: `searchParams` must not count as a hit for `params`.
      if (!new RegExp(`(^|[\\s,{])${prop}\\s*(,|\\}|$|:)`).test(destructured)) continue;

      // The only correct shape: awaited before anything is read off it.
      if (new RegExp(`await\\s+${prop}\\b`).test(source)) continue;

      // Passed straight through to something else that will await it is fine —
      // a layout handing params to a child, for instance.
      if (new RegExp(`${prop}\\s*=\\s*\\{?${prop}\\}?`).test(source)) continue;

      const line =
        source.slice(0, source.indexOf(match[0])).split("\n").length;
      findings.push({
        file: rel,
        line,
        prop,
        why: isAsync
          ? `reads \`${prop}\` without awaiting it`
          : `is not async, so \`${prop}\` can never be awaited`,
      });
    }
  }
}

if (!findings.length) {
  console.log("✓ every server component awaits its route parameters");
  process.exit(0);
}

console.log(`${findings.length} place${findings.length === 1 ? "" : "s"} reading route parameters off a Promise:\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}`);
  console.log(`    ${f.why}`);
  console.log(
    `    the value is undefined at runtime, with no error — see app/clock/page.jsx\n`,
  );
}
process.exit(1);
