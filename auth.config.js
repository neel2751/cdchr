/**
 * The half of the Auth.js configuration that is safe to run on the Edge.
 *
 * `proxy.js` runs on the Edge runtime and needs to read the session, but the
 * Credentials provider reaches into Mongoose (LoginData) and the signIn
 * callback hits the database for 2FA — neither can run there. So the pieces
 * split: this file holds everything needed to *decode* a session, and `auth.js`
 * adds the provider and the callbacks that need a database in order to *create*
 * one.
 *
 * Both files must agree on `secret` and `session`, or tokens minted by one
 * would not verify in the other.
 */
export const authConfig = {
  // Derive the URL from the incoming request instead of a single fixed
  // NEXTAUTH_URL. This is what makes several tenant domains possible: every
  // domain builds its own correct callback URLs.
  //
  // Safe here because the app always sits behind a proxy/load balancer that
  // sets Host and X-Forwarded-Host. If it is ever exposed directly, an attacker
  // controlling Host could influence redirect URLs.
  trustHost: true,

  // AUTH_SECRET is the v5 name; NEXTAUTH_SECRET is kept as a fallback so an
  // existing deployment does not have to change its environment to upgrade.
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,

  session: { strategy: "jwt" },

  pages: {
    signIn: "/auth",
    error: "/auth",
    verifyRequest: "/verify",
  },

  callbacks: {
    // Runs on the Edge as well as the server, so it must stay free of any
    // database access.
    async jwt({ token, user, trigger, session }) {
      if (user) {
        // Coerced to a string on purpose. `user` comes from a .lean() query, so
        // these are BSON ObjectIds, and v5 serializes them into the JWT as
        // `{ buffer: {...} }` rather than the hex string v4 produced. Roughly
        // fifty call sites feed session.user._id straight into findById.
        token.id = user._id ? String(user._id) : null;
        token.name = user.name;
        token.email = user.email;
        token.role = user.role;
        token.deviceId = user.deviceId;
        // Tenant the account belongs to. Recorded for later phases; nothing
        // reads it for authorization yet, and it is null for accounts with no
        // company set.
        token.companyId = user.companyId ? String(user.companyId) : null;
        token.requiresTwoFactor = user.requiresTwoFactor ?? false;
        token.mustSetup2FA = user.mustSetup2FA ?? false;
      }

      // Handle update, including 2FA verification
      if (trigger === "update" && session?.twoFactorVerified) {
        token.requiresTwoFactor = false;
      }
      // After forced enrolment completes, the user has just verified a code, so
      // clear both the setup requirement and the per-login verification flag.
      if (trigger === "update" && session?.twoFactorSetupComplete) {
        token.mustSetup2FA = false;
        token.requiresTwoFactor = false;
      }
      return token;
    },

    async session({ session, token }) {
      if (session?.user) {
        session.user._id = token.id;
        session.user.role = token.role;
        session.user.deviceId = token.deviceId;
        session.user.companyId = token.companyId ?? null;
        // Unlike v4, these are always present rather than only when truthy —
        // proxy.js reads the session (not the raw token) in v5, and it has to
        // be able to tell "false" from "not included".
        session.user.requiresTwoFactor = token.requiresTwoFactor ?? false;
        session.user.mustSetup2FA = token.mustSetup2FA ?? false;
      }
      return session;
    },
  },

  // Filled in by auth.js. Declared empty here so this config can build a
  // working Auth.js instance on its own for the Edge.
  providers: [],
};

export default authConfig;
