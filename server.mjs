import dotenv from "dotenv";
dotenv.config();
import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { makeSocketAuth, tenantRoom } from "./lib/socketAuth.js";
const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = 3000;
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

const SECRET = process.env.NEXTAUTH_SECRET || "";
// Auth.js v5 reads AUTH_SECRET first; NEXTAUTH_SECRET stays as the fallback.
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";

const qrRenderOptions = {
  errorCorrectionLevel: "M",
  margin: 1,
  width: 220,
};

async function buildQrPayload(token) {
  try {
    const qrDataUrl = await QRCode.toDataURL(token, qrRenderOptions);
    return { token, qrDataUrl };
  } catch (err) {
    console.error("Failed to pre-render QR payload:", err);
    return { token };
  }
}

// Restrict real-time (Socket.IO) connections to known origins instead of a
// wildcard. Origins are configured via SOCKET_CORS_ORIGINS (comma-separated)
// and fall back to the app's own URL; localhost is allowed in development only.
const allowedSocketOrigins = [
  ...(process.env.SOCKET_CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  process.env.NEXTAUTH_URL,
  process.env.NEXT_PUBLIC_WEB_URL,
  ...(dev ? ["http://localhost:3000"] : []),
].filter(Boolean);

app.prepare().then(() => {
  const server = createServer((req, res) => handler(req, res));
  const io = new Server(server, {
    cors: {
      // Tenants live on their own domains, so a fixed list cannot cover them.
      // Anything explicitly configured is allowed; otherwise the origin is
      // checked against the tenant resolver, which only answers for domains
      // that have been verified.
      origin: (origin, callback) => {
        if (!origin) return callback(null, true); // same-origin / non-browser
        if (allowedSocketOrigins.includes(origin)) return callback(null, true);
        isTenantOrigin(origin, port)
          .then((ok) => callback(ok ? null : new Error("origin not allowed"), ok))
          .catch(() => callback(new Error("origin not allowed"), false));
      },
      credentials: true,
    },
  });

  // Every connection must carry a valid session cookie and belong to a company.
  io.use(makeSocketAuth(AUTH_SECRET));

  const activeEmployees = new Map(); // employeeId -> { count, interval, socketId }
  const completedEmployees = new Set(); // employeeIds that reached the limit

  const tokenLimit = 2; // max tokens per employee
  const tokenInterval = 60000; // 30 seconds
  const tokenExpiration = 60; // token lifetime

  const officeTokens = new Map(); // token -> { action, siteId, expiresAt, usedEmployees: Set() }

  io.on("connection", (socket) => {
    // Confined to their own company's room: every broadcast below goes to this
    // room rather than to every connected client.
    const room = tenantRoom(socket.data.user.tenantId);
    socket.join(room);
    const toTenant = (event, payload) => io.to(room).emit(event, payload);
    console.log(`Employee connected ${socket.id} (${room})`);

    /** ============================
     * Office device generates QR
     * ============================ */
    socket.on("generate-office-qr", async ({ action, siteId }) => {
      const { tenantId } = socket.data.user;
      const token = jwt.sign({ action, siteId, tenantId }, SECRET, {
        expiresIn: "30s",
      });
      const expiresAt = Date.now() + 30000;

      officeTokens.set(token, { action, siteId, expiresAt, tenantId });

      socket.emit("new-office-qr", await buildQrPayload(token));

      // Automatically delete token after expiration
      setTimeout(() => {
        officeTokens.delete(token);
        toTenant("office-qr-expired", token); // Notify this company's office UI
        console.log(`Token expired: ${token}`);
      }, 30000);
    });

    /** ============================
     * Employee scans QR
     * ============================ */
    socket.on("employee-scan-qr", ({ token, employeeId }) => {
      const data = officeTokens.get(token);

      if (!data || data.expiresAt < Date.now()) {
        socket.emit("scan-error", "Token expired or invalid");
        return;
      }

      // A code minted for one company must not be redeemable from another,
      // even if it leaks — the token alone is not authority.
      if (data.tenantId !== socket.data.user.tenantId) {
        socket.emit("scan-error", "Token expired or invalid");
        return;
      }

      // Remove token immediately after first successful scan
      officeTokens.delete(token);

      // 🔹 Broadcast to all office UIs → remove QR
      toTenant("office-qr-used", token);

      // Record attendance
      console.log(
        `Employee ${employeeId} performed ${data.action} at site ${data.siteId}`,
      );

      socket.emit("scan-success", { action: data.action });
      toTenant("refresh-clock-table", employeeId);
    });

    /** ============================
     * Employee scans QR successfully
     * ============================ */
    socket.on("office-qr-used", (token) => {
      // 🔹 Delete the token so it can’t be reusedf
      officeTokens.delete(token);
      // 🔹 Tell this company's office devices to hide this QR
      toTenant("office-qr-used", token);
      console.log(`QR token used and removed: ${token}`);
    });

    // ============================ OLD CODE ============================

    socket.on("start-token-generation", (employeeId) => {
      if (completedEmployees.has(employeeId)) {
        console.log(
          `Employee ${employeeId} already completed token generation.`,
        );
        socket.emit("token-limit-reached"); // Inform client about the limit
        return;
      }

      if (activeEmployees.has(employeeId)) {
        activeEmployees.get(employeeId).socketId = socket.id;
        console.log(`Employee ${employeeId} reconnected, updated socket ID.`);
        return;
      }

      let count = 0;

      const sendToken = async () => {
        if (count >= tokenLimit) {
          clearInterval(interval);
          activeEmployees.delete(employeeId);
          completedEmployees.add(employeeId); // Mark employee as completed
          console.log(`Token limit reached for ${employeeId}`);
          socket.emit("token-limit-reached"); // Inform client about the limit
          console.log(`Emitting token-limit-reached to socket: ${socket.id}`);
          return;
        }

        const token = jwt.sign(
          { employeeId, tenantId: socket.data.user.tenantId },
          SECRET,
          { expiresIn: `${tokenExpiration}s` }
        );
        socket.emit("new-qr-token", await buildQrPayload(token));
        count++;
        console.log(`Token ${count}/${tokenLimit} sent to ${employeeId}`);
      };

      void sendToken(); // Immediate first token
      const interval = setInterval(() => {
        void sendToken();
      }, tokenInterval);
      activeEmployees.set(employeeId, { count, interval, socketId: socket.id });
    });

    socket.on("manual-request", ({ employeeId, action, siteId }) => {
      console.log(`Manual request received from ${employeeId}`);

      // If they're in completed, reset them
      completedEmployees.delete(employeeId);

      // If already active, stop old interval first
      if (activeEmployees.has(employeeId)) {
        clearInterval(activeEmployees.get(employeeId).interval);
        activeEmployees.delete(employeeId);
      }

      let count = 0;

      const sendToken = async () => {
        if (count >= tokenLimit) {
          clearInterval(interval);
          activeEmployees.delete(employeeId);
          completedEmployees.add(employeeId);
          console.log(`Token limit reached for ${employeeId} (via manual)`);
          socket.emit("token-limit-reached");
          return;
        }

        const token = jwt.sign(
          { employeeId, action, siteId, tenantId: socket.data.user.tenantId },
          SECRET,
          { expiresIn: `${tokenExpiration}s` }
        );
        socket.emit("new-qr-token", await buildQrPayload(token));
        count++;
        console.log(
          `Manual token ${count}/${tokenLimit} sent to ${employeeId}`,
        );
      };

      // Send first token immediately
      void sendToken();

      // Start interval for rest
      const interval = setInterval(() => {
        void sendToken();
      }, tokenInterval);
      activeEmployees.set(employeeId, { count, interval, socketId: socket.id });
    });

    socket.on("token-used", (employeeId) => {
      const emp = activeEmployees.get(employeeId);
      if (emp) {
        clearInterval(emp.interval);
        activeEmployees.delete(employeeId);
        completedEmployees.add(employeeId); // Mark as completed
        console.log(`Early scan stopped token stream for ${employeeId}`);
      }
    });

    socket.on("admin-clock-update", (employeeId) => {
      console.log("🛎️ Server received admin-clock-update for:", employeeId);
      toTenant("refresh-clock-table", employeeId);
    });

    socket.on("stop-qr", async (employeeId) => {
      console.log("Received stop-qr for:", employeeId); // <--- THIS SHOULD PRINT
      if (!completedEmployees.has(employeeId)) {
        const emp = activeEmployees.get(employeeId);
        if (emp) {
          clearInterval(emp.interval);
          activeEmployees.delete(employeeId);
          completedEmployees.add(employeeId);
          console.log(`Admin Stopped QR for ${employeeId}`);

          const employeeSocket = io.sockets.sockets.get(emp.socketId);
          if (employeeSocket) {
            employeeSocket.emit("token-limit-reached");
          }
          toTenant("refresh-clock-table", employeeId); // send full data
        }
      }
    });

    socket.on("disconnect", () => {
      for (const [empId, data] of activeEmployees.entries()) {
        if (data.socketId === socket.id) {
          clearInterval(data.interval);
          activeEmployees.delete(empId);
          console.log(`Disconnected: Cleaned up ${empId}`);
          break;
        }
      }
    });
  });

  server.listen(port, () => {
    console.log("> Ready on http://localhost:" + port);
    warmDatabaseConnection(port);
    scheduleVisaReminders(port);
  });
});

/**
 * Is this origin a domain some company has verified?
 *
 * Asks the app's own resolver, which only answers for verified domains and for
 * <slug>.<root> addresses — so an unverified claim cannot open a socket.
 */
async function isTenantOrigin(origin, serverPort) {
  try {
    const host = new URL(origin).hostname;
    const res = await fetch(
      `http://127.0.0.1:${serverPort}/api/tenant/resolve?host=${encodeURIComponent(host)}`
    );
    if (!res.ok) return false;
    const data = await res.json();
    return data?.type === "tenant" || data?.type === "platform";
  } catch {
    return false;
  }
}

/**
 * Open the database connection before real traffic arrives.
 *
 * The first query after a restart otherwise pays for the whole handshake — SRV
 * lookup, TLS, auth — inside whatever request happened to be first. Tenant
 * resolution has a deadline and would give up, so the first visitor after every
 * deploy got an unresolved tenant. Hitting any route that touches the database
 * is enough to establish the pool.
 */
function warmDatabaseConnection(serverPort) {
  fetch(`http://127.0.0.1:${serverPort}/api/tenant/resolve?host=warmup.invalid`)
    .then(() => console.log("[warmup] database connection ready"))
    .catch((err) => console.log("[warmup] skipped:", err?.message));
}

// Daily visa-expiry reminder job. Dependency-free scheduler: triggers the
// internal API route (which runs inside Next, so DB + path aliases resolve)
// once a day at 09:00. Requires CRON_SECRET to be set.
function scheduleVisaReminders(serverPort) {
  const RUN_HOUR = 9;

  const runOnce = async () => {
    if (!process.env.CRON_SECRET) {
      console.log("[visa-cron] CRON_SECRET not set; skipping run");
      return;
    }
    try {
      const res = await fetch(
        `http://127.0.0.1:${serverPort}/api/cron/visa-reminders`,
        {
          method: "POST",
          headers: { "x-cron-secret": process.env.CRON_SECRET },
        },
      );
      const json = await res.json().catch(() => ({}));
      console.log("[visa-cron] run complete:", JSON.stringify(json));
    } catch (err) {
      console.error("[visa-cron] run failed:", err?.message);
    }
  };

  const now = new Date();
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const msUntilNext = next - now;

  setTimeout(() => {
    runOnce();
    setInterval(runOnce, 24 * 60 * 60 * 1000);
  }, msUntilNext);

  console.log(
    `[visa-cron] scheduled; first run in ~${Math.round(msUntilNext / 60000)} min`,
  );
}
