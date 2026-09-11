/**
 * Are the plan-gated modules' server actions actually plan-gated?
 *
 * Every server action is a POST endpoint. proxy.js keeps a company without a
 * module off its pages, but that is navigation only — an action can be called
 * directly, so each gated module's actions carry their own check via
 * lib/requireFeature.js. That is a rule no type or test enforces: a new export
 * added to one of these files is ungated by default and nothing complains.
 *
 * This is the thing that complains. Run it after touching any of the files
 * below, or when adding a module to data/features.js.
 *
 *   npm run audit:feature-guards
 *
 * It is a static check, deliberately: it reads source rather than calling
 * anything, so it needs no database, no session and no running app.
 */

import fs from "node:fs";

/**
 * How each file satisfies the rule.
 *   direct — every export calls featureRefusal() itself
 *   helper — every export goes through a shared guard that calls it
 * `exempt` lists exports that are deliberately ungated; each one needs a
 * comment in the source saying why.
 */
const EXPECT = [
  { file: "server/siteProjectServer/siteProjectServer.js", mode: "direct", exempt: [] },
  { file: "server/siteAssignServer/siteAssignServer.js", mode: "direct", exempt: [] },
  { file: "server/deviceServer/deviceServer.js", mode: "direct", exempt: [] },
  {
    file: "server/deviceServer/deviceManagementServer.js",
    mode: "direct",
    // The device-trust check itself, called before a session exists.
    exempt: ["verifyDevice"],
  },
  { file: "server/document/documentManagementServer.js", mode: "helper", exempt: [] },
  { file: "server/announcementServer/announcementServer.js", mode: "helper", exempt: [] },
  { file: "server/expenseServer/expenseServer.js", mode: "helper", exempt: [] },
];

const EXPORT_RE = /^export (?:async function|const) (\w+)/gm;

/** Where each exported action starts, so a body can be sliced from the next. */
function declarations(src) {
  return [...src.matchAll(EXPORT_RE)].map((m) => ({ name: m[1], at: m.index }));
}

function bodyOf(src, decls, i) {
  const end = i + 1 < decls.length ? decls[i + 1].at : src.length;
  return src.slice(decls[i].at, end);
}

/**
 * `withAudit("X", someHandler, …)` puts the real work in a named function
 * defined elsewhere in the file. Follow it, or every audited action reads as
 * ungated.
 */
function resolveHandler(src, body) {
  const name = /^\s*(\w+Handler),?\s*$/m.exec(body)?.[1];
  if (!name) return null;
  const at = src.indexOf(`function ${name}(`);
  return at === -1 ? null : src.slice(at, at + 4000);
}

let problems = 0;
const problem = (msg) => {
  console.log(`FAIL ${msg}`);
  problems++;
};

for (const { file, mode, exempt } of EXPECT) {
  if (!fs.existsSync(file)) {
    problem(`${file}: missing — was it moved? Update this script.`);
    continue;
  }
  const src = fs.readFileSync(file, "utf8");
  const decls = declarations(src);

  if (!decls.length) {
    problem(`${file}: no exports matched — the export style changed.`);
    continue;
  }

  // What each export must contain to count as gated.
  let needle = "featureRefusal";
  if (mode === "helper") {
    const helper = /async function (require\w+)\(/.exec(src)?.[1];
    if (!helper) {
      problem(`${file}: expected a require*() guard helper, found none.`);
      continue;
    }
    const at = src.indexOf(`async function ${helper}(`);
    const helperBody = src.slice(at, src.indexOf("\n}", at));
    if (!helperBody.includes("featureRefusal") && !helperBody.includes("isFeatureEnabled")) {
      problem(`${file}: ${helper}() does not check the plan.`);
      continue;
    }
    needle = `${helper}()`;
  } else if (!src.includes("featureRefusal")) {
    problem(`${file}: does not import or call featureRefusal at all.`);
    continue;
  }

  const missing = [];
  for (let i = 0; i < decls.length; i++) {
    const { name } = decls[i];
    if (exempt.includes(name)) continue;
    const body = bodyOf(src, decls, i);
    if (body.includes(needle)) continue;
    const handler = resolveHandler(src, body);
    if (handler?.includes(needle)) continue;
    missing.push(name);
  }

  if (missing.length) {
    problem(`${file}: ungated exports — ${missing.join(", ")}`);
  } else {
    const note = exempt.length ? ` (exempt: ${exempt.join(", ")})` : "";
    console.log(`ok   ${file} — ${decls.length} exports gated${note}`);
  }
}

// The refusal has to be a refusal the callers recognise.
const guard = fs.readFileSync("lib/requireFeature.js", "utf8");
if (!/success:\s*false/.test(guard)) {
  problem("lib/requireFeature.js: refusal is not the { success: false } shape.");
}
if (!guard.includes("if (!user?._id) return null")) {
  problem("lib/requireFeature.js: the signed-out short-circuit is gone.");
}

console.log(
  problems
    ? `\n${problems} problem(s) found.`
    : "\nPASS — every gated module's actions check the plan."
);
process.exit(problems ? 1 : 0);
