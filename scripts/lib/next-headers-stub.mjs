/**
 * Stand-in for next/headers when app code runs under plain node.
 *
 * lib/audit.js imports it at module scope, so anything that reaches
 * logAuditDirect() — the announcement scheduler, for one — cannot be loaded
 * without it. The real module is request-scoped and has no ESM entry Node can
 * resolve on its own.
 *
 * Throwing is the honest behaviour: outside a request there are no headers, and
 * the only caller (getRequestContext) already treats that as "no IP, no user
 * agent" inside a try/catch. Returning a fake empty header bag would instead
 * let a test quietly pass on a code path that reads request state.
 */
const noRequest = () => {
  throw new Error("next/headers is not available outside a request");
};

export const headers = noRequest;
export const cookies = noRequest;
export const draftMode = noRequest;
