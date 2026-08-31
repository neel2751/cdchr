/**
 * Stand-in for server/session/session.js when tests run outside Next.
 *
 * The real one calls `auth()`, which reads request headers — there are none in
 * a plain node process, so any server action that identifies its caller is
 * untestable without this. The session is a mutable global the test sets before
 * each call, which is the whole point: acting as an admin, then as an ordinary
 * user, is what proves an authorisation check exists.
 */
export async function getServerSideProps() {
  const session = globalThis.__TEST_SESSION;
  if (!session) {
    return { redirect: { destination: "/auth/login", permanent: false } };
  }
  return { props: { session } };
}

/** Set the caller for subsequent server-action calls. `null` = signed out. */
export function actAs(user) {
  globalThis.__TEST_SESSION = user ? { user } : null;
}
