/**
 * Which record does an email sign in as?
 *
 * There is no user table in this app: a person IS an employee record, a record
 * belongs to one company, and the password is a field on it. So one address can
 * own several records with several passwords, and sign-in has to work out which
 * one is being presented.
 *
 * It used to take the oldest record and check only that one's password. Every
 * test below marked PRODUCTION is a thing that actually happened on
 * 2026-10-16, or would have happened the first time somebody left one of two
 * companies.
 *
 * A distinct email per test on purpose: LoginData counts failed attempts and
 * locks the address out, so sharing one address between tests would make a
 * later test fail because an earlier one guessed wrong.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_login?replicaSet=rs0" \
 *     node --import ./scripts/lib/action-loader.mjs scripts/test-login-identity.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

dotenv.config();

const results = [];

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database — this script writes.");
    process.exit(1);
  }
  await mongoose.connect(uri);

  const OfficeEmployee = (await import("@/models/officeEmployeeModel")).default;
  const { LoginData } = await import("@/server/authServer/authServer");
  const { NO_MATCH_MESSAGE, codeForLoginMessage, describeLoginError, LOGIN_ERROR } =
    await import("@/lib/authErrors");

  const db = mongoose.connection.db;
  for (const c of ["officeemployes", "loginattempts", "tenantmemberships", "companies"]) {
    await db.collection(c).deleteMany({});
  }

  const COMPANY_A = new mongoose.Types.ObjectId();
  const COMPANY_B = new mongoose.Types.ObjectId();
  await db.collection("companies").insertMany([
    { _id: COMPANY_A, name: "Company A" },
    { _id: COMPANY_B, name: "Company B" },
  ]);

  const hash = (plain) => bcrypt.hashSync(plain, 10);

  /** A record in a company, created oldest-first by insertion order. */
  const makeRecord = async ({ email, name, tenantId, password, isActive = true }) =>
    OfficeEmployee.collection.insertOne({
      email,
      name,
      tenantId,
      password: password === null ? undefined : hash(password),
      isActive,
      delete: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  const login = (email, password) => LoginData(email, password, "test-device", "127.0.0.1");

  // ─── the ordinary case, which must keep working ───────────────────────────
  await check("one account, right password, signs in", async () => {
    await makeRecord({ email: "solo@a.test", name: "Solo", tenantId: COMPANY_A, password: "Correct1!" });
    const res = await login("solo@a.test", "Correct1!");
    assert.equal(res.status, true, res.message);
  });

  await check("one account, wrong password, is refused", async () => {
    await makeRecord({ email: "solo2@a.test", name: "Solo2", tenantId: COMPANY_A, password: "Correct1!" });
    const res = await login("solo2@a.test", "Wrong1!");
    assert.equal(res.status, false);
    assert.equal(res.message, NO_MATCH_MESSAGE);
  });

  // ─── PRODUCTION: the password was on the record that does not sort first ──
  await check(
    "PRODUCTION: a password set on the second record signs in",
    async () => {
      // Order matters: the Company A record is created first, so it is the one
      // the old code picked. The password is only on the Company B record,
      // exactly as it was for the two employees this was found with.
      const email = "two@shared.test";
      await makeRecord({ email, name: "Old test record", tenantId: COMPANY_A, password: "NobodyKnows9!" });
      await makeRecord({ email, name: "Real record", tenantId: COMPANY_B, password: "Cdc@1234" });

      const res = await login(email, "Cdc@1234");
      assert.equal(res.status, true, `the real password was refused: ${res.message}`);
      // And it signs in AS that record, not as the one that sorted first.
      assert.equal(res.data?.name, "Real record");
    },
  );

  await check("the first record's password still works too", async () => {
    const email = "two2@shared.test";
    await makeRecord({ email, name: "First", tenantId: COMPANY_A, password: "FirstPass1!" });
    await makeRecord({ email, name: "Second", tenantId: COMPANY_B, password: "SecondPass1!" });
    const res = await login(email, "FirstPass1!");
    assert.equal(res.status, true, res.message);
    assert.equal(res.data?.name, "First");
  });

  await check("two admins set two passwords and both work", async () => {
    // Each company's super admin may reset their own record. Nothing
    // reconciles them, so the honest outcome is that each password opens the
    // record it was set on — rather than one of them silently doing nothing.
    const email = "two3@shared.test";
    await makeRecord({ email, name: "A side", tenantId: COMPANY_A, password: "AaaaPass1!" });
    await makeRecord({ email, name: "B side", tenantId: COMPANY_B, password: "BbbbPass1!" });
    assert.equal((await login(email, "AaaaPass1!")).status, true, "A's password failed");
    assert.equal((await login(email, "BbbbPass1!")).status, true, "B's password failed");
  });

  // ─── PRODUCTION-IN-WAITING: one company deactivating locks out another ────
  await check(
    "PRODUCTION: an inactive record does not lock you out of the other company",
    async () => {
      // The shape that was one resignation away: the old company marks the
      // person inactive, and the old code refused the login outright — telling
      // them to contact an admin at the company that no longer employs them.
      const email = "leaver@shared.test";
      await makeRecord({
        email,
        name: "Left this company",
        tenantId: COMPANY_A,
        password: "StillSame1!",
        isActive: false,
      });
      await makeRecord({ email, name: "Current job", tenantId: COMPANY_B, password: "StillSame1!" });

      const res = await login(email, "StillSame1!");
      assert.equal(res.status, true, `an active employee was refused: ${res.message}`);
      assert.equal(res.data?.name, "Current job");
    },
  );

  await check("when every record is inactive, it says so", async () => {
    const email = "gone@shared.test";
    await makeRecord({ email, name: "Gone A", tenantId: COMPANY_A, password: "Password1!", isActive: false });
    await makeRecord({ email, name: "Gone B", tenantId: COMPANY_B, password: "Password1!", isActive: false });
    const res = await login(email, "Password1!");
    assert.equal(res.status, false);
    assert.match(res.message, /inactive/i);
  });

  await check("a wrong password never reveals that the account is inactive", async () => {
    // "Inactive" is only safe to say to somebody who proved they hold the
    // password. Said before that, it confirms the address exists.
    const email = "gone2@shared.test";
    await makeRecord({ email, name: "Gone", tenantId: COMPANY_A, password: "Password1!", isActive: false });
    const res = await login(email, "NotThePassword1!");
    assert.equal(res.status, false);
    assert.equal(res.message, NO_MATCH_MESSAGE, "the inactive state leaked to a guess");
  });

  await check("a record with no password cannot sign anybody in, and does not throw", async () => {
    const email = "nopass@shared.test";
    await makeRecord({ email, name: "No password", tenantId: COMPANY_A, password: null });
    await makeRecord({ email, name: "Has one", tenantId: COMPANY_B, password: "RealOne1!" });
    assert.equal((await login(email, "RealOne1!")).status, true);
    const res = await login(email, "");
    assert.equal(res.status, false);
  });

  // ─── no enumeration ──────────────────────────────────────────────────────
  await check("an unknown email and a wrong password are indistinguishable", async () => {
    await makeRecord({ email: "known@a.test", name: "Known", tenantId: COMPANY_A, password: "Correct1!" });
    const unknown = await login("nobody-at-all@nowhere.test", "Whatever1!");
    const wrong = await login("known@a.test", "Whatever1!");
    assert.equal(unknown.message, wrong.message, "the two answers differ");
    assert.equal(unknown.message, NO_MATCH_MESSAGE);
  });

  await check("both causes carry the same wire code, which is what reaches the URL", async () => {
    // The sentence is not enough on its own: the CODE travels in a query
    // parameter, so EMAIL_NOT_FOUND in a URL would say it regardless.
    assert.equal(codeForLoginMessage(NO_MATCH_MESSAGE), LOGIN_ERROR.NO_MATCH);
    assert.equal(codeForLoginMessage("Email not found"), LOGIN_ERROR.NO_MATCH);
    assert.equal(codeForLoginMessage("Invalid password. Try again."), LOGIN_ERROR.NO_MATCH);
  });

  await check("the server's sentence is one the recogniser knows", async () => {
    // The trap this closes: codeForLoginMessage matches on wording, so a
    // reworded message that nothing matches becomes SERVER_ERROR and tells the
    // user the app is broken instead of that their password was wrong.
    const code = codeForLoginMessage(NO_MATCH_MESSAGE);
    assert.notEqual(code, LOGIN_ERROR.SERVER_ERROR);
    assert.equal(describeLoginError(code).message, NO_MATCH_MESSAGE);
  });

  await check("a stale link carrying the old code no longer leaks", async () => {
    for (const old of [LOGIN_ERROR.EMAIL_NOT_FOUND, LOGIN_ERROR.INVALID_PASSWORD]) {
      assert.equal(describeLoginError(old).message, NO_MATCH_MESSAGE);
    }
  });

  await mongoose.disconnect();

  const failed = results.filter(([s]) => s === "FAIL");
  for (const [, name] of failed) console.log(`FAIL  ${name}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
