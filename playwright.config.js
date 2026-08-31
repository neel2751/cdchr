import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config();

/**
 * End-to-end configuration.
 *
 * The one rule here that matters: **this starts its own server against a local
 * fixture database.** `.env` points MONGO_DB_URL at a shared Atlas cluster, and
 * these tests create, edit, approve and delete records — running them against
 * that would write test data into real companies. The env below overrides it,
 * and `scripts/seed-dev-fixtures.mjs` refuses any non-local host as a second
 * line of defence.
 *
 * Port 3100, not 3000, so a dev server you already have running (probably
 * pointed at the real database) is left alone.
 *
 *   docker run -d --name cdchr-test-mongo -p 27017:27017 mongo:7 \
 *     --replSet rs0 --bind_ip_all
 *   docker exec cdchr-test-mongo mongosh --quiet --eval \
 *     'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
 *   npm run e2e:seed
 *   npm run e2e
 */
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_DB = "mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0";

export default defineConfig({
  testDir: "./e2e",
  // Serial: the specs share one company's data, and an expense approved by one
  // test while another is counting rows is a flake, not a finding.
  workers: 1,
  fullyParallel: false,
  // A failing assertion here should be read, not retried until it passes.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    // Production mode, and it builds first. Two reasons: Next 16 refuses to
    // start a second *dev* server in a directory that already has one, so a
    // dev-mode run would collide with whatever you have open on 3000; and a
    // build is what actually ships, so this exercises that rather than the dev
    // compiler. The build is incremental and usually takes seconds.
    //
    // `next start` rather than server.mjs: the custom server exists to attach
    // socket.io and the cron jobs, none of which expenses use, and it takes its
    // port from the environment rather than an argument. Going through Next
    // directly keeps this config independent of that file.
    command: `npx next build && npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      MONGO_DB_URL: TEST_DB,
      // The whole point of these tests is the enforced path.
      TENANT_ENFORCEMENT: "enforce",
      // Auth.js builds callback URLs from this; leaving the .env value would
      // point the sign-in round trip at the wrong origin.
      NEXTAUTH_URL: BASE_URL,
      AUTH_URL: BASE_URL,
      AUTH_TRUST_HOST: "true",
    },
  },
});
