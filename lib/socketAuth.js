import { decode } from "@auth/core/jwt";

/**
 * Identifying a Socket.IO connection.
 *
 * Connections were previously unauthenticated: anything that could reach the
 * origin could open a socket, ask the server to mint QR tokens, and receive
 * every event the server broadcast. With more than one company on the platform
 * that also meant one company's office screen receiving another's clock and QR
 * traffic, employee ids included.
 *
 * The browser already holds an Auth.js session cookie, and Socket.IO's opening
 * handshake is an ordinary same-origin HTTP request, so the cookie arrives with
 * it. Decoding it here gives the same identity the rest of the app trusts —
 * without inventing a second token to keep in sync.
 *
 * Kept out of server.mjs so it can be tested directly.
 */

/**
 * Auth.js derives its encryption key from a salt, and uses the cookie's own
 * name as that salt. Production sets the __Secure- prefix, so both spellings
 * have to be tried — the server has no reliable way to know which the browser
 * sent beyond looking.
 */
export const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

/** Parse a Cookie header into a plain object. */
export function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[name] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/**
 * Decode the Auth.js session from a Cookie header.
 *
 * @returns the JWT payload, or null when there is no valid session. Never
 * throws: a malformed or expired cookie is simply "not signed in".
 */
export async function sessionFromCookieHeader(cookieHeader, secret) {
  if (!secret) return null;
  const cookies = parseCookies(cookieHeader);

  for (const name of SESSION_COOKIE_NAMES) {
    const token = cookies[name];
    if (!token) continue;
    try {
      // The salt must match the cookie the token was minted for, which is why
      // the name is carried through rather than hardcoded.
      const payload = await decode({ token, secret, salt: name });
      if (payload) return payload;
    } catch {
      // Wrong salt or a tampered token — try the other name, then give up.
    }
  }
  return null;
}

/** The room a company's events are confined to. */
export function tenantRoom(tenantId) {
  return `tenant:${tenantId}`;
}

/**
 * Socket.IO middleware that attaches the caller's identity, or refuses the
 * connection.
 *
 * @param {string} secret AUTH_SECRET / NEXTAUTH_SECRET
 */
export function makeSocketAuth(secret) {
  return async function socketAuth(socket, next) {
    try {
      const session = await sessionFromCookieHeader(
        socket.handshake?.headers?.cookie,
        secret
      );

      if (!session?.id) {
        return next(new Error("unauthorized"));
      }

      // A user with no company cannot be put in a room, and every event this
      // server sends is company-scoped, so there is nothing to subscribe them
      // to. Platform admins have no tenant and no business on these channels.
      if (!session.tenantId) {
        return next(new Error("no company"));
      }

      socket.data.user = {
        id: String(session.id),
        role: session.role,
        tenantId: String(session.tenantId),
      };
      return next();
    } catch (error) {
      return next(new Error("unauthorized"));
    }
  };
}
