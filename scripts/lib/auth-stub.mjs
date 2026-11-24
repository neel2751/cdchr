/**
 * Stand-in for `@/auth` when tests run outside Next — the session the test set
 * with actAs() (scripts/lib/session-stub.mjs), or none.
 */
export async function auth() {
  return globalThis.__TEST_SESSION || null;
}

export async function signIn() {}
export async function signOut() {}
export const handlers = {};
