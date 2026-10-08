/**
 * Clock-in code tests.
 *
 * The code an employee scans is the only evidence they were physically at a
 * clock-in point. Before this it proved nothing: the server action checked the
 * JWT's signature, discarded the payload, and took the site and action from
 * whatever the browser sent alongside it — so any unexpired token signed with
 * the app secret worked for any site, from anywhere, as many times as it was
 * replayed within its lifetime.
 *
 * These are the assertions that hold that shut. The replay and cross-tenant
 * cases are the ones that matter; the rest exist so a future change that
 * loosens them fails loudly.
 *
 * Needs a LOCAL database — it writes. The script refuses anything else.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_clocktokens" \
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-clock-tokens.mjs
 */
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

dotenv.config();

const MODE = process.env.TENANT_ENFORCEMENT || "shadow";
const ENFORCING = MODE === "enforce";

const results = [];
let withTenant = (fn) => fn();

function check(name, fn) {
  return Promise.resolve()
    .then(() => withTenant(fn))
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error(
      "Set MONGO_DB_URL to a LOCAL database — this script writes and drops.",
    );
    process.exit(1);
  }
  if (!process.env.NEXTAUTH_SECRET) {
    console.error("NEXTAUTH_SECRET must be set — codes are signed with it.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const ClockToken = (await import("@/models/clockTokenModel")).default;
  const { runWithTenant } = await import("@/lib/tenantContext");
  const {
    TOKEN_TTL_SECONDS,
    consumeClockToken,
    signClockToken,
    verifyClockToken,
  } = await import("@/server/clockServer/clockTokenStore");

  await mongoose.connection.db.collection("clocktokens").deleteMany({});
  await ClockToken.syncIndexes();

  const tenantA = new mongoose.Types.ObjectId();
  const tenantB = new mongoose.Types.ObjectId();
  const employeeId = new mongoose.Types.ObjectId();
  const siteId = new mongoose.Types.ObjectId();

  withTenant = (fn) => runWithTenant(String(tenantA), fn);
  const asTenantB = (fn) => runWithTenant(String(tenantB), fn);

  /** Mint a row + token the way issueClockToken does, without the session. */
  const mint = async ({ site = siteId, ttl = TOKEN_TTL_SECONDS } = {}) => {
    const jti = randomUUID();
    await ClockToken.create({
      jti,
      siteId: site,
      expiresAt: new Date(Date.now() + ttl * 1000),
    });
    return { jti, token: signClockToken(jti) };
  };

  /* ------------------------------------------------------------ happy path */

  await check("a fresh code verifies and carries its site", async () => {
    const { token } = await mint();
    const v = await verifyClockToken(token);
    assert.equal(v.ok, true, v.message);
    assert.equal(v.siteId, String(siteId));
  });

  await check("an office code carries no site", async () => {
    const { token } = await mint({ site: null });
    const v = await verifyClockToken(token);
    assert.equal(v.ok, true);
    assert.equal(v.siteId, null);
  });

  await check("verifying does not spend the code", async () => {
    const { token, jti } = await mint();
    await verifyClockToken(token);
    await verifyClockToken(token);
    const row = await ClockToken.findOne({ jti }).lean();
    assert.equal(row.usedAt, null, "verify must be read-only");
  });

  await check("consuming marks it used, by whom", async () => {
    const { token, jti } = await mint();
    const v = await verifyClockToken(token);
    const spent = await consumeClockToken(v.jti, employeeId);
    assert.equal(spent.ok, true);
    assert.equal(spent.siteId, String(siteId));

    const row = await ClockToken.findOne({ jti }).lean();
    assert.ok(row.usedAt, "usedAt not set");
    assert.equal(String(row.usedBy), String(employeeId));
  });

  /* -------------------------------------------------------------- replay */

  await check("REPLAY: a spent code will not verify again", async () => {
    const { token } = await mint();
    const first = await verifyClockToken(token);
    await consumeClockToken(first.jti, employeeId);

    const second = await verifyClockToken(token);
    assert.equal(second.ok, false);
    assert.match(second.message, /already been used/);
  });

  await check("REPLAY: a spent code will not consume again", async () => {
    const { token } = await mint();
    const v = await verifyClockToken(token);
    assert.equal((await consumeClockToken(v.jti, employeeId)).ok, true);

    const again = await consumeClockToken(v.jti, employeeId);
    assert.equal(again.ok, false, "a code must not be spendable twice");
  });

  await check("REPLAY: ten simultaneous redemptions, one winner", async () => {
    // Two people in a queue scanning the same screen at the same instant. Both
    // pass verify; the filter is what settles it.
    const { token } = await mint();
    const v = await verifyClockToken(token);

    const runs = await Promise.all(
      Array.from({ length: 10 }, () =>
        consumeClockToken(v.jti, new mongoose.Types.ObjectId()),
      ),
    );
    const winners = runs.filter((r) => r.ok).length;
    assert.equal(winners, 1, `expected exactly one winner, got ${winners}`);
  });

  /* ------------------------------------------------------------- expiry */

  await check("an expired code is refused even before the TTL sweep", async () => {
    // Mongo's TTL monitor runs about once a minute, so the row is still there.
    // Redemption must not rely on the sweeper having caught up.
    const { token, jti } = await mint({ ttl: -5 });
    assert.ok(await ClockToken.findOne({ jti }).lean(), "row should still exist");

    const v = await verifyClockToken(token);
    assert.equal(v.ok, false);
    assert.match(v.message, /expired/);
  });

  await check("an expired code cannot be consumed either", async () => {
    const { jti } = await mint({ ttl: -5 });
    const spent = await consumeClockToken(jti, employeeId);
    assert.equal(spent.ok, false);
  });

  await check("the TTL index is declared on expiresAt", async () => {
    const indexes = await mongoose.connection.db
      .collection("clocktokens")
      .indexes();
    const ttl = indexes.find((i) => i.expireAfterSeconds !== undefined);
    assert.ok(ttl, "no TTL index found");
    assert.deepEqual(ttl.key, { expiresAt: 1 });
  });

  /* ------------------------------------------------------------ forgery */

  await check("FORGERY: a token signed with another secret is refused", async () => {
    const { jti } = await mint();
    const forged = jwt.sign({ jti }, "not-the-app-secret", { expiresIn: "30s" });
    const v = await verifyClockToken(forged);
    assert.equal(v.ok, false, "a wrong signature must not verify");
  });

  await check("FORGERY: a validly signed jti with no row is refused", async () => {
    // The shape of the old bug: signature valid, everything else invented.
    const v = await verifyClockToken(signClockToken(randomUUID()));
    assert.equal(v.ok, false);
    assert.match(v.message, /expired/);
  });

  await check("FORGERY: garbage is refused rather than thrown", async () => {
    for (const bad of ["", null, undefined, "not.a.jwt", 12345, {}]) {
      const v = await verifyClockToken(bad);
      assert.equal(v.ok, false, `accepted ${JSON.stringify(bad)}`);
      assert.ok(v.message, "a refusal must say something");
    }
  });

  await check("expiry and forgery give the same answer", async () => {
    // Distinguishing them tells an attacker which half of the check failed.
    const expired = await verifyClockToken(
      jwt.sign({ jti: randomUUID() }, process.env.NEXTAUTH_SECRET, {
        expiresIn: "-10s",
      }),
    );
    const forged = await verifyClockToken(
      jwt.sign({ jti: randomUUID() }, "wrong-secret", { expiresIn: "30s" }),
    );
    assert.equal(expired.message, forged.message);
  });

  /* -------------------------------------------------------- cross-tenant */

  await check("CROSS-TENANT: another company cannot verify the code", async () => {
    // The signing secret is shared across tenants, so the signature alone
    // proves nothing about which company a code belongs to. The scoped lookup
    // is the whole of that protection.
    const { token } = await mint();

    const seen = await asTenantB(() => verifyClockToken(token));
    if (ENFORCING) {
      assert.equal(seen.ok, false, "tenant B must not be able to use A's code");
    } else {
      // Shadow mode filters nothing, by design — so it also does not separate
      // companies here. Asserted rather than skipped so the exposure is on the
      // record: under shadow, a leaked code is redeemable from any tenant.
      assert.equal(seen.ok, true, "shadow mode unexpectedly scoped the lookup");
    }
  });

  await check("CROSS-TENANT: another company cannot spend the code", async () => {
    const { token, jti } = await mint();
    const v = await verifyClockToken(token);
    assert.equal(v.ok, true);

    const stolen = await asTenantB(() =>
      consumeClockToken(v.jti, new mongoose.Types.ObjectId()),
    );

    if (ENFORCING) {
      assert.equal(stolen.ok, false, "tenant B must not spend A's code");
      // And it is still good for the company it belongs to.
      const row = await ClockToken.findOne({ jti }).lean();
      assert.equal(row.usedAt, null, "tenant B burned tenant A's code");
      assert.equal((await consumeClockToken(v.jti, employeeId)).ok, true);
    } else {
      assert.equal(stolen.ok, true, "shadow mode unexpectedly scoped the write");
    }
  });

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();

  const failed = results.filter(([s]) => s !== "pass");
  for (const [status, name] of results) {
    if (status !== "pass") console.log(`  ${status}  ${name}`);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} passed` +
      (failed.length ? ` — ${failed.length} FAILED` : ""),
  );
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
