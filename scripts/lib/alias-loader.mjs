/**
 * Minimal ESM loader that resolves the "@/..." alias outside Next.js.
 *
 * jsconfig.json's `paths` only apply to the bundler, so plain `node` cannot
 * import a model file — every one of them imports "@/lib/tenantPlugin". This
 * makes model-level tests runnable directly:
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-tenant-scope.mjs
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import { register } from "node:module";
import { existsSync } from "node:fs";

const projectRoot = pathToFileURL(`${process.cwd()}/`).href;

// Node's ESM resolver requires an explicit extension; the bundler does not, and
// the app's imports are written for the bundler ("@/lib/tenantContext").
const CANDIDATES = ["", ".js", ".jsx", ".mjs", "/index.js"];

export function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context);

  const base = new URL(specifier.slice(2), projectRoot).href;
  for (const ext of CANDIDATES) {
    const candidate = base + ext;
    if (existsSync(fileURLToPath(candidate))) return next(candidate, context);
  }
  return next(base, context);
}

// Self-registering: `node --import <this file>` installs the hook above into
// the module loader for the process.
if (!process.env.__ALIAS_LOADER_REGISTERED) {
  process.env.__ALIAS_LOADER_REGISTERED = "1";
  register(import.meta.url, import.meta.url);
}
