import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import axios from "axios";

import { authConfig } from "./auth.config";
import {
  check2FAEnabled,
  hasRecentTwoFactorVerification,
} from "@/server/2FAServer/TwoAuthserver";
import { LoginData, storeSession } from "@/server/authServer/authServer";
import { passwordSecurityState } from "@/server/authServer/passwordSecurity";
import { assertCanSwitchTenant } from "@/server/tenantServer/membershipServer";
import { activeSupportSession } from "@/server/tenantServer/supportServer";
import {
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginAttempts,
} from "@/lib/rateLimit";
import {
  LOGIN_ERROR,
  codeForLoginMessage,
  encodeLoginError,
} from "@/lib/authErrors";

/**
 * The full Auth.js setup. Runs on the Node runtime only — it reaches the
 * database through LoginData and check2FAEnabled.
 *
 * The Edge half lives in auth.config.js; see the note there on why they split.
 */

/**
 * Carries a short code to the browser.
 *
 * Auth.js drops any message thrown from `authorize()` and forwards only `code`,
 * so the wording is reconstructed in the browser from lib/authErrors.js.
 */
class LoginError extends CredentialsSignin {
  constructor(code, payload) {
    super(code);
    this.code = encodeLoginError(code, payload);
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    Credentials({
      id: "credentials",
      name: "Custom Sign In",
      credentials: {},

      async authorize(credentials, request) {
        // v5 hands over a standard Request, so headers are read through the
        // Headers API rather than v4's plain object.
        const headers = request?.headers;
        const platform = headers?.get("sec-ch-ua-platform") || "";
        const isMobile = headers?.get("sec-ch-ua-mobile") === '"?1"';
        const browser = headers?.get("sec-ch-ua");
        const ip =
          headers?.get("x-forwarded-for") || headers?.get("x-real-ip") || "";

        if (!credentials?.email || !credentials?.password) {
          throw new LoginError(LOGIN_ERROR.MISSING_CREDENTIALS);
        }

        const { email, password, deviceId } = credentials;

        // Brute-force protection: block further attempts once this email/IP
        // pair has exceeded the failed-attempt threshold.
        const rate = await checkLoginRateLimit(email, ip);
        if (!rate.allowed) {
          const minutes = Math.max(1, Math.ceil(rate.retryAfterSec / 60));
          throw new LoginError(LOGIN_ERROR.RATE_LIMITED, minutes);
        }

        const response = await LoginData(email, password, deviceId);

        if (!response?.status) {
          if (response?.message === "DEVICE_UNAUTHORIZED") {
            // A known user on an unrecognised device — handled by the device
            // approval flow, so it is not counted as a brute-force attempt.
            throw new LoginError(
              LOGIN_ERROR.DEVICE_UNAUTHORIZED,
              response.detectedId
            );
          }

          // Count this failure (wrong password, unknown email, etc.) and, once
          // the threshold is reached, the account/IP will be locked.
          await recordFailedLogin(email, ip);
          throw new LoginError(codeForLoginMessage(response?.message));
        }

        // Successful login — reset the failed-attempt counter.
        await clearLoginAttempts(email, ip);

        // Optional: record where the login came from. Best-effort — a failure
        // to geolocate or to write the session must never block signing in.
        try {
          const geo = await axios
            .get("https://ipwho.is/")
            .then((r) => r.data)
            .catch((err) => {
              console.log("IP API error:", err.message);
              return null;
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
        } catch (error) {
          console.log("Session logging failed:", error?.message);
        }

        return { ...response.data, deviceId };
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    /**
     * Adds session-update handling to the Edge-safe base callback.
     *
     * The 2FA gate is cleared here and only here, because lifting it requires
     * asking the database whether a code was really accepted. Trusting the
     * update payload — as this did before — let anyone holding a valid session
     * cookie POST `{ twoFactorVerified: true }` to /api/auth/session and skip
     * two-factor entirely.
     */
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params);
      const { trigger, session } = params;

      // Checked on every call, not just updates: a visit must lapse on its own
      // deadline even if the browser never asks again.
      if (token?.impersonation?.expiresAt) {
        if (new Date(token.impersonation.expiresAt) <= new Date()) {
          token.impersonation = null;
          token.tenantId = null;
        }
      }

      // A password reset can end every session and/or demand a new password.
      // Both are read from the database on each call rather than trusted from
      // the token: the token was minted before the reset happened, so it is the
      // one thing that cannot know about it.
      //
      // Checked before the `trigger` early-return below, which only runs for
      // explicit session updates — an ended session has to end on the very next
      // request, not whenever the browser next happens to ask.
      if (token?.id) {
        const state = await passwordSecurityState(token.id);

        // `iat` is seconds; sessionsValidFrom is a Date. A token minted before
        // the cut-off is refused outright, which is what signs every device
        // out — returning null here drops the session.
        if (
          state?.sessionsValidFrom &&
          token.iat &&
          token.iat * 1000 < new Date(state.sessionsValidFrom).getTime()
        ) {
          return null;
        }

        token.mustChangePassword = state?.mustChangePassword === true;
      }

      if (trigger !== "update" || !token?.id) return token;

      // Forced enrolment: accept only if 2FA is now genuinely enabled for this
      // account, which enable2FA() writes after checking the code.
      if (session?.twoFactorSetupComplete) {
        if (await check2FAEnabled(token.id)) {
          token.mustSetup2FA = false;
          token.requiresTwoFactor = false;
        }
      }

      // Per-login verification: accept only if a TOTP code was accepted for
      // this account moments ago (stamped by verify2FAWithDB).
      if (session?.twoFactorVerified) {
        if (await hasRecentTwoFactorVerification(token.id)) {
          token.requiresTwoFactor = false;
        }
      }

      // A support visit is applied from the database record, never from the
      // payload: the browser asks to "refresh support state" and the server
      // decides what that means. A revoked or expired visit therefore ends even
      // if the cookie still claims it.
      if (session?.refreshSupport && token.role === "platformAdmin") {
        const visit = await activeSupportSession(token.id);
        if (visit) {
          token.impersonation = {
            tenantId: String(visit.tenantId),
            tenantName: visit.tenantName,
            expiresAt: new Date(visit.expiresAt).toISOString(),
            readOnly: true,
          };
          // Scoping every query to the visited company is the whole point.
          token.tenantId = String(visit.tenantId);
        } else {
          token.impersonation = null;
          token.tenantId = null;
        }
      }

      // Switching company changes which tenant every later query is filtered
      // by, so the membership is confirmed in the database. A client asserting
      // a tenant id gets nothing.
      if (session?.switchTenantId) {
        const membership = await assertCanSwitchTenant(
          token.id,
          session.switchTenantId
        );
        if (membership) {
          token.tenantId = membership.tenantId;
          // The role travels with the company: someone can be a super admin in
          // the company they founded and an ordinary admin in another.
          token.role = membership.role;
        }
      }

      return token;
    },

    // Needs the database, so it lives here rather than in the Edge config.
    async signIn({ user, account }) {
      if (account?.provider === "credentials") {
        const enabled = await check2FAEnabled(user._id);
        // Privileged accounts must use 2FA. If enabled, they verify on each
        // login; if not yet enabled, they are forced to set it up first.
        const privileged =
          user.role === "admin" ||
          user.role === "superAdmin" ||
          user.role === "platformAdmin";
        user.requiresTwoFactor = enabled;
        user.mustSetup2FA = privileged && !enabled;
      }
      return true;
    },
  },
});
