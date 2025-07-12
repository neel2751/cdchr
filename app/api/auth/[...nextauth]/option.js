import { check2FAEnabled } from "@/server/2FAServer/TwoAuthserver";
import { LoginData, storeSession } from "@/server/authServer/authServer";
import axios from "axios";
import CredentialsProvider from "next-auth/providers/credentials";

export const options = {
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Custom Sign In",
      credentials: {},
      async authorize(credentials, req) {
        const platform = req.headers["sec-ch-ua-platform"] || "";
        const isMobile = req.headers["sec-ch-ua-mobile"] === '"?1"';
        const browser = req.headers["sec-ch-ua"];
        const ip =
          req.headers["x-forwarded-for"] || req.connection.remoteAddress;

        try {
          if (!credentials?.email || !credentials?.password) {
            throw new Error("Please provide both email and password.");
          }

          const { email, password } = credentials;
          const response = await LoginData(email, password);

          if (!response?.status) {
            throw new Error(response?.message || "Invalid login attempt.");
          }

          // Optional: Fetch and store session details
          const newip = await axios
            .get("http://ip-api.com/json/")
            .catch((err) => {
              console.error("IP API error:", err.message);
              return { status: 500, data: {} }; // Fallback if API fails
            });

          if (newip.data.status === "success") {
            await storeSession({
              ...newip.data,
              ...response.data,
              platform,
              browser,
              device: isMobile ? "Mobile" : "Desktop",
              ip,
            });
          }
          // based on that we have to show 2FA page once enabled after they can't disable without admin approval
          // if (response.data.twoFactorEnabled && !response.data.twoFactorVerified) {
          // }
          return { ...response?.data };
        } catch (error) {
          console.error("Authorize error:", error.message);
          throw new Error(error.message); // Propagate error to sign-in page
        }
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    jwt: { encryption: true },
  },
  callbacks: {
    // we have to show the 2FA after LoginData is authenticated
    async signIn({ user, account }) {
      if (account.provider === "credentials") {
        const id = user._id;
        const dbUser = await check2FAEnabled(id);
        if (dbUser) {
          user.requiresTwoFactor = dbUser;
          return true; // Allow sign-in if 2FA is enabled
        }
        user.requiresTwoFactor = false; // If 2FA is not enabled, continue with sign-in
        return true; // Allow sign-in
      }
      return true; // Return true to allow sign-in
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user._id;
        token.name = user.name;
        token.email = user.email;
        token.role = user.role;
        token.requiresTwoFactor = user.requiresTwoFactor ?? false; // Initialize 2FA requirement status
      }
      // Handle update, including 2FA verification
      if (trigger === "update" && session?.twoFactorVerified) {
        token.requiresTwoFactor = false; // Reset 2FA requirement if verified
      }
      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        session.user._id = token.id;
        session.user.role = token.role;
      }
      // Include 2FA requirement status in session
      if (token.requiresTwoFactor) {
        session.user.requiresTwoFactor = token.requiresTwoFactor;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth", // Sign-in page
    error: "/auth", // Error page
    verifyRequest: "/verify", // Verification page
  },
};
