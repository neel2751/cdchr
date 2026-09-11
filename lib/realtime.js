/**
 * Sending a real-time event from a server action.
 *
 * The Socket.IO server is created in server.mjs, which is the same process that
 * runs Next — but there is no import path between them: server.mjs imports the
 * app, not the other way round. It parks the server on globalThis and this
 * reads it back.
 *
 * A global is the honest description of what this is. The alternative would be
 * an internal HTTP round-trip to the app's own port, which is a lot of
 * machinery to reach an object that is already in memory.
 *
 * Everything here is best-effort and silent on failure. Real-time is a
 * convenience layer over data that is already correct in the database — if the
 * socket server is not up (during `next build`, in a test, or when the app is
 * run through `next start` rather than server.mjs), the bell still updates on
 * its next fetch.
 */

const KEY = Symbol.for("cdchr.socket.io");

/** Called once by server.mjs, after the Socket.IO server is created. */
export function registerSocketServer(io) {
  globalThis[KEY] = io;
}

/** The Socket.IO server, or null when the app is not running under server.mjs. */
export function getSocketServer() {
  return globalThis[KEY] || null;
}

/** The room a company's events are confined to. Mirrors lib/socketAuth.js. */
export function tenantRoom(tenantId) {
  return `tenant:${tenantId}`;
}

/**
 * Emit an event to everyone signed into one company.
 *
 * @param {string} tenantId
 * @param {string} event
 * @param {any} payload  keep it small — a hint to refetch, not a copy of the
 *   record. Clients re-read through the normal server actions, which is what
 *   keeps the tenant and audience checks in one place.
 * @returns {boolean} whether it was actually sent
 */
export function emitToTenant(tenantId, event, payload) {
  if (!tenantId) return false;
  const io = getSocketServer();
  if (!io) return false;
  try {
    io.to(tenantRoom(String(tenantId))).emit(event, payload);
    return true;
  } catch (error) {
    console.log("[realtime] emit failed:", error?.message);
    return false;
  }
}
