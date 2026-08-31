/**
 * The alias loader, plus a stubbed session, so tests can call server actions.
 *
 * scripts/lib/alias-loader.mjs is enough to import *models*. Server actions
 * need one thing more: `server/session/session.js` calls `auth()`, which needs
 * a request. Redirecting that one module to a stub the test controls turns the
 * actions themselves into something a script can exercise — which matters,
 * because in this codebase the action *is* the business logic and the
 * authorisation check.
 *
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-expense.mjs
 */
import { register } from "node:module";

// Suppress alias-loader's self-registration: this file registers itself below
// and delegates, so letting it register too would install the hook twice.
process.env.__ALIAS_LOADER_REGISTERED = "1";
const { resolve: aliasResolve } = await import("./alias-loader.mjs");

const SESSION_STUB = new URL("./session-stub.mjs", import.meta.url).href;

// Matches both the alias form ("@/server/session/session") and the relative one
// the expense and upload servers actually use ("../session/session").
const SESSION_MODULE = /(^|\/)session\/session(\.js)?$/;

export function resolve(specifier, context, next) {
  if (SESSION_MODULE.test(specifier)) return next(SESSION_STUB, context);
  return aliasResolve(specifier, context, next);
}

if (!process.env.__ACTION_LOADER_REGISTERED) {
  process.env.__ACTION_LOADER_REGISTERED = "1";
  register(import.meta.url, import.meta.url);
}
