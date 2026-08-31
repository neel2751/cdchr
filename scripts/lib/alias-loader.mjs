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

/** Try the bundler's extension order against a resolved base URL. */
function withExtension(base, context, next) {
  for (const ext of CANDIDATES) {
    const candidate = base + ext;
    if (existsSync(fileURLToPath(candidate))) return next(candidate, context);
  }
  return next(base, context);
}

export function resolve(specifier, context, next) {
  // Request-scoped and unresolvable outside Next's own loader. lib/audit.js
  // imports it at module scope, so it has to resolve to something for any
  // script that touches the audit log. See the stub for why it throws.
  if (specifier === "next/headers") {
    return next(new URL("./next-headers-stub.mjs", import.meta.url).href, context);
  }

  // Next ships its subpaths (next/server, next/navigation, …) as plain files
  // with no "exports" map, so ESM resolution never appends the extension the
  // bundler would. Reached transitively: lib/audit.js -> session -> next-auth.
  if (specifier.startsWith("next/")) {
    return withExtension(
      new URL(`node_modules/${specifier}`, projectRoot).href,
      context,
      next
    );
  }

  if (specifier.startsWith("@/")) {
    return withExtension(new URL(specifier.slice(2), projectRoot).href, context, next);
  }

  // Relative imports are extensionless too ("./tenantServer"), and Node only
  // forgives that for the alias form unless it is handled here as well.
  if (specifier.startsWith(".") && context.parentURL) {
    const base = new URL(specifier, context.parentURL).href;
    if (!/\.[mc]?jsx?$/.test(specifier)) {
      return withExtension(base, context, next);
    }
  }

  return next(specifier, context);
}

// Self-registering: `node --import <this file>` installs the hook above into
// the module loader for the process.
if (!process.env.__ALIAS_LOADER_REGISTERED) {
  process.env.__ALIAS_LOADER_REGISTERED = "1";
  register(import.meta.url, import.meta.url);
}
