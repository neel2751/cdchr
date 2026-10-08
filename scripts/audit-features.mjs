/**
 * Does the feature registry still hold together?
 *
 *   npm run audit:features
 *
 * data/features.js is the single source of truth for plan gating: the schema
 * keys, the route guard, the sidebar filter and the platform console all derive
 * from it. That makes an edit there cheap to get wrong and expensive to notice,
 * because every mistake fails quietly:
 *
 *   - a path claimed by two modules   — whichever sorts first silently wins
 *   - a path that swallows a core one — "/admin/employee" also gating
 *                                       "/admin/employeeAttendance"
 *   - a group no renderer knows       — the module vanishes from the console
 *   - a preset missing a key          — absent means enabled, so it switches a
 *                                       module back on instead of off
 *   - an unenforced `requires`        — a combination that cannot work is
 *                                       saveable
 *
 * None of those break a build or a page. This is what notices them.
 *
 * Static and pure: no database, no session, no running app.
 */

import {
  FEATURES,
  FEATURE_KEYS,
  FEATURE_GROUPS,
  FEATURE_PRESETS,
  PATH_TO_FEATURE,
  CORE_PATHS,
  featuresForPreset,
} from "../data/features.js";
import {
  isPathAllowed,
  filterMenuByFeatures,
  resolveFeatureDependencies,
  dependentsToDisable,
  isFeatureEnabled,
} from "../lib/tenantPlan.js";

let problems = 0;
const fail = (...m) => {
  problems++;
  console.log("FAIL:", ...m);
};
const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fail(msg, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

const allOff = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false]));
const allOn = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));

// --- 1. registry shape ----------------------------------------------------
{
  const keys = new Set();
  const paths = new Set();
  for (const f of FEATURES) {
    if (keys.has(f.key)) fail(`duplicate key "${f.key}"`);
    keys.add(f.key);
    if (!f.label || !f.description || !f.group) {
      fail(`"${f.key}" is missing label, description or group`);
    }
    if (!f.paths?.length) fail(`"${f.key}" gates no paths`);
    for (const p of f.paths || []) {
      if (paths.has(p)) fail(`path "${p}" is claimed by two modules`);
      paths.add(p);
      if (!p.startsWith("/") || p.endsWith("/")) fail(`malformed path "${p}"`);
    }
    for (const r of f.requires || []) {
      if (!FEATURE_KEYS.includes(r)) fail(`"${f.key}" requires unknown "${r}"`);
      if (r === f.key) fail(`"${f.key}" requires itself`);
    }
  }
}

// --- 2. core paths stay reachable ----------------------------------------
for (const path of Object.keys(CORE_PATHS)) {
  if (!isPathAllowed(allOff, path)) {
    fail(`core path "${path}" is gated by a module`);
  }
}
for (const gated of Object.keys(PATH_TO_FEATURE)) {
  for (const core of Object.keys(CORE_PATHS)) {
    if (core.startsWith(`${gated}/`)) {
      fail(`gated "${gated}" swallows core path "${core}"`);
    }
  }
}

// --- 3. gating behaves, including near-miss prefixes ----------------------
const CASES = [
  ["/admin/employee", false],
  ["/admin/previousEmployee", false],
  ["/employee", false],
  ["/employee/announcements", false],
  ["/hr", false],
  ["/admin/weeklyRota", false],
  ["/admin/my-leaves", false],
  ["/admin/filterAttendance", false],
  ["/admin/officeEmployee", true],
  ["/admin/attendance", true],
  ["/admin/my-announcements", true],
  ["/admin/auditLogs", true],
  ["/admin/dashboard", true],
  ["/admin/settings", true],
  // Must NOT be caught by "/admin/employee" or "/employee".
  ["/admin/employeeAttendance", true],
  ["/employeeXYZ", true],
];
for (const [path, expected] of CASES) {
  if (isPathAllowed(allOff, path) !== expected) {
    fail(`with every module off, "${path}" should be ${expected ? "allowed" : "denied"}`);
  }
}

// --- 4. absent means enabled ---------------------------------------------
// The rule every live company depends on: a document with no flags keeps
// everything. If this breaks, deploying takes modules away from customers.
for (const path of [...Object.keys(PATH_TO_FEATURE), ...Object.keys(CORE_PATHS)]) {
  if (!isPathAllowed({}, path)) fail(`an empty feature map gated "${path}"`);
  if (!isPathAllowed(undefined, path)) fail(`undefined features gated "${path}"`);
}

// --- 5. menu filtering ----------------------------------------------------
{
  const kept = filterMenuByFeatures(
    [
      { path: "/admin/employee" },
      { path: "/admin/officeEmployee" },
      { path: "/admin/siteProject" },
    ],
    { siteEmployees: false, siteProjects: false }
  ).map((i) => i.path);
  eq(kept, ["/admin/officeEmployee"], "menu filtering dropped the wrong entries");
}

// --- 6. groups ------------------------------------------------------------
for (const f of FEATURES) {
  if (!FEATURE_GROUPS.includes(f.group)) {
    fail(`"${f.key}" is in group "${f.group}", which the console does not render`);
  }
}

// --- 7. presets -----------------------------------------------------------
for (const preset of FEATURE_PRESETS) {
  const map = featuresForPreset(preset.key);
  eq(
    Object.keys(map).sort(),
    [...FEATURE_KEYS].sort(),
    `preset "${preset.key}" is not a complete flag map`
  );
  for (const key of preset.off) {
    if (!FEATURE_KEYS.includes(key)) {
      fail(`preset "${preset.key}" switches off unknown module "${key}"`);
    }
  }
  for (const key of FEATURE_KEYS) {
    const expected = !preset.off.includes(key);
    if (map[key] !== expected) {
      fail(`preset "${preset.key}": ${key} is ${map[key]}, expected ${expected}`);
    }
  }
  // Applying a preset must not then cascade something off on save.
  eq(
    resolveFeatureDependencies(map),
    map,
    `preset "${preset.key}" is not dependency-consistent`
  );
}
if (featuresForPreset("no-such-preset") !== null) {
  fail("an unknown preset key should resolve to null");
}
eq(featuresForPreset("construction"), allOn, "the construction preset must be everything on");

// --- 8. dependency resolution --------------------------------------------
// Every declared requirement is actually enforced.
for (const f of FEATURES) {
  for (const req of f.requires || []) {
    const resolved = resolveFeatureDependencies({ [req]: false, [f.key]: true });
    if (resolved[f.key] !== false) {
      fail(`"${f.key}" requires "${req}" but is not switched off when it is off`);
    }
    if (isFeatureEnabled(resolved, req)) {
      fail(`resolving "${f.key}" silently switched its prerequisite "${req}" back on`);
    }
  }
}

// Off wins; absent counts as on; nothing is invented or mutated.
eq(resolveFeatureDependencies({}), {}, "an empty map must stay empty");
eq(resolveFeatureDependencies(undefined), {}, "undefined must resolve to an empty map");
eq(resolveFeatureDependencies(allOff), allOff, "all-off must be stable");
eq(resolveFeatureDependencies(allOn), allOn, "all-on must cascade nothing");
eq(dependentsToDisable(allOn), [], "all-on should report no cascades");

{
  const input = { siteEmployees: false, siteProjects: true };
  const snapshot = { ...input };
  const once = resolveFeatureDependencies(input);
  eq(input, snapshot, "resolveFeatureDependencies mutated its input");
  eq(resolveFeatureDependencies(once), once, "resolveFeatureDependencies is not idempotent");
}

console.log(
  problems
    ? `\n${problems} problem(s) found.`
    : `\nPASS — ${FEATURES.length} modules in ${FEATURE_GROUPS.length} groups, ` +
        `${Object.keys(PATH_TO_FEATURE).length} gated paths, ` +
        `${Object.keys(CORE_PATHS).length} core paths, ` +
        `${FEATURE_PRESETS.length} presets.`
);
process.exit(problems ? 1 : 0);
