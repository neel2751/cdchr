import dotenv from "dotenv";
dotenv.config();
import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import { makeSocketAuth, tenantRoom } from "./lib/socketAuth.js";
import { registerSocketServer } from "./lib/realtime.js";
const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = 3000;
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

// Auth.js v5 reads AUTH_SECRET first; NEXTAUTH_SECRET stays as the fallback.
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";

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

  // Hand the server to the app. Next runs in this process but cannot import
  // from here, so lib/realtime.js reads it back off globalThis — that is what
  // lets a server action (publishing an announcement, say) push to clients.
  registerSocketServer(io);

  io.on("connection", (socket) => {
    // Confined to their own company's room: every broadcast below goes to this
    // room rather than to every connected client.
    const room = tenantRoom(socket.data.user.tenantId);
    socket.join(room);
    const toTenant = (event, payload) => io.to(room).emit(event, payload);
    console.log(`Employee connected ${socket.id} (${room})`);

    /** ============================
     * Employee scanned a QR
     *
     * Notification only. Clock-in codes used to be minted here and held in a
     * Map in this process, which is why nothing else could tell whether one
     * had been spent: a server action cannot reach into the socket server's
     * memory, so the code it redeemed stayed valid for its full lifetime. The
     * codes now live in the database — issued by server/clockServer/clockToken.js
     * and burned by the same action that writes the attendance record — so by
     * the time this event arrives the decision has already been made and
     * recorded.
     *
     * What is left is telling the room: take this code off the reception
     * screen, and refresh the attendance tables.
     * ============================ */
    socket.on("employee-scan-qr", ({ token, employeeId }) => {
      if (token) toTenant("office-qr-used", token);
      toTenant("refresh-clock-table", employeeId);
    });

    socket.on("office-qr-used", (token) => {
      toTenant("office-qr-used", token);
    });

    socket.on("admin-clock-update", (employeeId) => {
      console.log("🛎️ Server received admin-clock-update for:", employeeId);
      toTenant("refresh-clock-table", employeeId);
    });


  });

  server.listen(port, () => {
    console.log("> Ready on http://localhost:" + port);
    warmDatabaseConnection(port);
    scheduleVisaReminders(port);
    scheduleAnnouncements(port);
    scheduleShiftClose(port);
    scheduleDunning(port);
    scheduleCarryForwardExpiry(port);
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

// Takes expired carried-over leave days off the balance. Same shape as the jobs
// above: once a day, early. Requires CRON_SECRET.
//
// The booking path already refuses an expired carried day from the instant it
// expires, so this job is not what makes expiry correct — it is what makes the
// stored figures agree with it, which is what an employee's own leave card and
// every report read. Idempotent, so a missed night costs nothing.
function scheduleCarryForwardExpiry(serverPort) {
  const RUN_HOUR = 4;

  const runOnce = async () => {
    if (!process.env.CRON_SECRET) {
      console.log("[carry-expiry] CRON_SECRET not set; skipping run");
      return;
    }
    try {
      const res = await fetch(
        `http://127.0.0.1:${serverPort}/api/cron/leave-carry-expiry`,
        {
          method: "POST",
          headers: { "x-cron-secret": process.env.CRON_SECRET },
        },
      );
      const json = await res.json().catch(() => ({}));
      console.log("[carry-expiry] run complete:", JSON.stringify(json));
    } catch (err) {
      console.error("[carry-expiry] run failed:", err?.message);
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
    `[carry-expiry] scheduled; first run in ~${Math.round(msUntilNext / 60000)} min`,
  );
}

// Flags yesterday's unclosed shifts and works out overtime on the ones that did
// close. Same shape as the visa job: once a day, early, after the working day
// it is looking at has definitely ended. Requires CRON_SECRET.
function scheduleShiftClose(serverPort) {
  const RUN_HOUR = 3;

  const runOnce = async () => {
    if (!process.env.CRON_SECRET) {
      console.log("[shift-close] CRON_SECRET not set; skipping run");
      return;
    }
    try {
      const res = await fetch(
        `http://127.0.0.1:${serverPort}/api/cron/close-shifts`,
        {
          method: "POST",
          headers: { "x-cron-secret": process.env.CRON_SECRET },
        },
      );
      const json = await res.json().catch(() => ({}));
      // Quiet on a night when there was nothing to do.
      if (json?.results?.flagged || json?.results?.priced) {
        console.log("[shift-close] run complete:", JSON.stringify(json));
      }
    } catch (err) {
      console.error("[shift-close] run failed:", err?.message);
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
    `[shift-close] scheduled; first run in ~${Math.round(msUntilNext / 60000)} min`,
  );
}

// Chases overdue invoices. Same shape as the others, but at a civilised hour:
// a payment reminder timestamped 03:00 reads as automated nagging, and 09:00 is
// when somebody might actually act on it.
//
// The job itself is off unless a platform admin has enabled it — see
// server/billingServer/dunningJob.js. Scheduling it here costs nothing while
// it is off, and means turning it on does not also need a deploy.
function scheduleDunning(serverPort) {
  const RUN_HOUR = 9;

  const runOnce = async () => {
    if (!process.env.CRON_SECRET) {
      console.log("[dunning] CRON_SECRET not set; skipping run");
      return;
    }
    try {
      const res = await fetch(
        `http://127.0.0.1:${serverPort}/api/cron/dunning`,
        {
          method: "POST",
          headers: { "x-cron-secret": process.env.CRON_SECRET },
        },
      );
      const json = await res.json().catch(() => ({}));
      // Quiet when it is switched off or had nothing to chase.
      if (json?.results?.sent || json?.results?.failed) {
        console.log("[dunning] run complete:", JSON.stringify(json));
      }
    } catch (err) {
      console.error("[dunning] run failed:", err?.message);
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
    `[dunning] scheduled; first run in ~${Math.round(msUntilNext / 60000)} min`,
  );
}

// Publishes scheduled announcements. Same shape as the visa job, but on a short
// interval rather than a daily slot: "publish at 09:00" has to mean 09:00, and
// the widest it can be wrong by is one tick.
function scheduleAnnouncements(serverPort) {
  const EVERY_MS = 5 * 60 * 1000;

  const runOnce = async () => {
    if (!process.env.CRON_SECRET) return; // logged once below, not every tick
    try {
      const res = await fetch(
        `http://127.0.0.1:${serverPort}/api/cron/announcements`,
        {
          method: "POST",
          headers: { "x-cron-secret": process.env.CRON_SECRET },
        },
      );
      const json = await res.json().catch(() => ({}));
      // Quiet when there was nothing to do — this runs 288 times a day.
      if (json?.results?.published || json?.results?.failed) {
        console.log("[announcement-cron] run complete:", JSON.stringify(json));
      }
    } catch (err) {
      console.error("[announcement-cron] run failed:", err?.message);
    }
  };

  if (!process.env.CRON_SECRET) {
    console.log("[announcement-cron] CRON_SECRET not set; scheduled publishing is off");
    return;
  }

  // Offset from startup so it does not collide with the warm-up request.
  setTimeout(() => {
    runOnce();
    setInterval(runOnce, EVERY_MS);
  }, 30 * 1000);

  console.log("[announcement-cron] scheduled; runs every 5 min");
}
