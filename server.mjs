import dotenv from "dotenv";
dotenv.config();
import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = 3000;
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

const SECRET = process.env.NEXTAUTH_SECRET || ""; // Replace with env variable in prod

app.prepare().then(() => {
  const server = createServer((req, res) => handler(req, res));
  const io = new Server(server, {
    cors: {
      origin: "*",
      credentials: true,
    },
  });

  const activeEmployees = new Map(); // employeeId -> { count, interval, socketId }
  const completedEmployees = new Set(); // employeeIds that reached the limit

  const tokenLimit = 2; // max tokens per employee
  const tokenInterval = 60000; // 30 seconds
  const tokenExpiration = 60; // token lifetime

  io.on("connection", (socket) => {
    console.log("Employee connected", socket.id);

    socket.on("start-token-generation", (employeeId) => {
      if (completedEmployees.has(employeeId)) {
        console.log(
          `Employee ${employeeId} already completed token generation.`
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

      const sendToken = () => {
        if (count >= tokenLimit) {
          clearInterval(interval);
          activeEmployees.delete(employeeId);
          completedEmployees.add(employeeId); // Mark employee as completed
          console.log(`Token limit reached for ${employeeId}`);
          socket.emit("token-limit-reached"); // Inform client about the limit
          console.log(`Emitting token-limit-reached to socket: ${socket.id}`);
          return;
        }

        const token = jwt.sign({ employeeId }, SECRET, {
          expiresIn: `${tokenExpiration}s`,
        });
        socket.emit("new-qr-token", token);
        count++;
        console.log(`Token ${count}/${tokenLimit} sent to ${employeeId}`);
      };

      sendToken(); // Immediate first token
      const interval = setInterval(sendToken, tokenInterval);
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

      const sendToken = () => {
        if (count >= tokenLimit) {
          clearInterval(interval);
          activeEmployees.delete(employeeId);
          completedEmployees.add(employeeId);
          console.log(`Token limit reached for ${employeeId} (via manual)`);
          socket.emit("token-limit-reached");
          return;
        }

        const token = jwt.sign({ employeeId, action, siteId }, SECRET, {
          expiresIn: `${tokenExpiration}s`,
        });
        socket.emit("new-qr-token", token);
        count++;
        console.log(
          `Manual token ${count}/${tokenLimit} sent to ${employeeId}`
        );
      };

      // Send first token immediately
      sendToken();

      // Start interval for rest
      const interval = setInterval(sendToken, tokenInterval);
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
      io.emit("refresh-clock-table", employeeId);
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
          io.emit("refresh-clock-table", employeeId); // send full data
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
  });
});
