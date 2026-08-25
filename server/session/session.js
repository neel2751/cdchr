"use server";

import { auth } from "@/auth";

/**
 * The app's session accessor, used by ~50 server actions.
 *
 * The odd `{ props: { session } }` shape is a leftover from the Pages Router
 * and is kept deliberately: every caller destructures it, so preserving it made
 * the Auth.js v4 → v5 upgrade a change to this one file instead of fifty.
 *
 * Note it does not redirect despite the `redirect` key — server actions cannot
 * redirect from here, and callers already guard on a missing user.
 */
export async function getServerSideProps() {
  const session = await auth();

  if (!session) {
    return {
      redirect: {
        destination: "/auth/login",
        permanent: false,
      },
    };
  }

  return {
    props: {
      session,
    },
  };
}
