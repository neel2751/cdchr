import { check2FAEnabled } from "@/server/2FAServer/TwoAuthserver";
import { LoginData, storeSession } from "@/server/authServer/authServer";
import {
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginAttempts,
} from "@/lib/rateLimit";
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

          const { email, password, deviceId } = credentials;

          // Brute-force protection: block further attempts once this email/IP
          // pair has exceeded the failed-attempt threshold.
          const rate = await checkLoginRateLimit(email, ip);
          if (!rate.allowed) {
            const minutes = Math.max(1, Math.ceil(rate.retryAfterSec / 60));
            throw new Error(
              `Too many failed login attempts. Please try again in ${minutes} minute(s).`
            );
          }

          const response = await LoginData(email, password, deviceId);

          if (!response?.status) {
            if (response.message === "DEVICE_UNAUTHORIZED") {
              // A known user on an unrecognised device — handled by the device
              // approval flow, so it is not counted as a brute-force attempt.
              throw new Error(
                JSON.stringify({
                  type: "DEVICE_ERROR",
                  message: "Unauthorized Device",
                  detectedId: response.detectedId,
                })
              );
            }

            // Count this failure (wrong password, unknown email, etc.) and,
            // once the threshold is reached, the account/IP will be locked.
            await recordFailedLogin(email, ip);
            throw new Error(response.message || "Invalid login attempt.");
          }

          // Successful login — reset the failed-attempt counter.
          await clearLoginAttempts(email, ip);

          // Optional: Fetch and store session details. Uses an HTTPS
          // geolocation provider and normalizes the response to the field
          // names that storeSession expects (query/lat/lon/etc.).
          const geo = await axios
            .get("https://ipwho.is/")
            .then((r) => r.data)
            .catch((err) => {
              console.log("IP API error:", err.message);
              return null; // Fallback if API fails
            });

          if (geo?.success) {
            await storeSession({
              status: "success",
              query: geo.ip,
              country: geo.country,
              city: geo.city,
              zip: geo.postal,
              lat: geo.latitude,
              lon: geo.longitude,
              isp: geo.connection?.isp,
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
          return { ...response?.data, deviceId };
        } catch (error) {
          console.log("Authorization error:", error);
          throw new Error(error); // Propagate error to sign-in page
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
        const enabled = await check2FAEnabled(id);
        // Privileged accounts must use 2FA. If enabled, they must verify each
        // login; if not yet enabled, they are forced to set it up first.
        const privileged = user.role === "admin" || user.role === "superAdmin";
        user.requiresTwoFactor = enabled;
        user.mustSetup2FA = privileged && !enabled;
        return true;
      }
      return true; // Return true to allow sign-in
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user._id;
        token.name = user.name;
        token.email = user.email;
        token.role = user.role;
        token.deviceId = user.deviceId;
        token.requiresTwoFactor = user.requiresTwoFactor ?? false; // Initialize 2FA requirement status
        token.mustSetup2FA = user.mustSetup2FA ?? false; // Forced 2FA enrolment
      }
      // Handle update, including 2FA verification
      if (trigger === "update" && session?.twoFactorVerified) {
        token.requiresTwoFactor = false; // Reset 2FA requirement if verified
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
      }
      // Include 2FA requirement status in session
      if (token.requiresTwoFactor) {
        session.user.requiresTwoFactor = token.requiresTwoFactor;
      }
      if (token.mustSetup2FA) {
        session.user.mustSetup2FA = token.mustSetup2FA;
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
