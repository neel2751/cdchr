/**
 * Find SMTP accounts the app cannot actually use.
 *
 * Three ways an account can look configured and never send:
 *
 *   unknown feature   `feature` is the key resolveAccount() looks up when
 *                     choosing a sender. Only "All" and "HR" are ever asked
 *                     for. The form used to be free text suggesting "Invoice,
 *                     HR Bot", so anything could be saved.
 *
 *   custom host, no hostname
 *                     `host: "other"` means the real hostname is in
 *                     `otherHost`. Saved empty, the app tries to connect to a
 *                     machine literally called "other".
 *
 *   duplicate feature Two accounts for one feature. Only one is ever selected;
 *                     the other is dead weight and makes it look as though
 *                     changing it would change something.
 *
 * Read-only. It writes nothing and is safe against production.
 *
 *   node scripts/audit-smtp-accounts.mjs
 *   node scripts/audit-smtp-accounts.mjs --json
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const AS_JSON = process.argv.includes("--json");

// Kept in step with data/emailFeatures.js. Duplicated rather than imported so
// the script runs under plain node without the "@/" alias loader.
const KNOWN_FEATURES = ["All", "HR", "Accounts", "Noreply"];

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;

  const companies = await db
    .collection("companies")
    .find({}, { projection: { name: 1 } })
    .toArray();
  const companyName = new Map(
    companies.map((c) => [String(c._id), c.name || "(unnamed)"])
  );

  const rows = await db
    .collection("emailaccounts")
    .find(
      { isDeleted: { $ne: true } },
      {
        projection: {
          host: 1,
          otherHost: 1,
          userName: 1,
          feature: 1,
          isActive: 1,
          isPrimary: 1,
          tenantId: 1,
          password: 1,
        },
      }
    )
    .toArray();

  const describe = (r) => ({
    id: String(r._id),
    company: r.tenantId
      ? companyName.get(String(r.tenantId)) || "(unknown company)"
      : "(platform-level)",
    host: r.host === "other" ? r.otherHost || "(blank)" : r.host || "(blank)",
    rawHost: r.host,
    userName: r.userName || "(none)",
    feature: r.feature || "(none)",
    isActive: r.isActive !== false,
    hasPassword: !!r.password,
  });

  const unknownFeature = rows
    .filter((r) => !KNOWN_FEATURES.includes(r.feature || "All"))
    .map(describe);

  const blankCustomHost = rows
    .filter((r) => r.host === "other" && !String(r.otherHost || "").trim())
    .map(describe);

  const noPassword = rows.filter((r) => !r.password).map(describe);

  // Duplicates are per company: two tenants may each have their own "HR".
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.tenantId ? String(r.tenantId) : "platform"}::${r.feature || "All"}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  const duplicateFeature = [...byKey.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({
      company: describe(list[0]).company,
      feature: key.split("::")[1],
      accounts: list.map(describe),
    }));

  const report = {
    database: db.databaseName,
    total: rows.length,
    unknownFeature,
    blankCustomHost,
    noPassword,
    duplicateFeature,
  };

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
    await mongoose.disconnect();
    return;
  }

  console.log(`Database: ${db.databaseName}`);
  console.log(`${rows.length} SMTP account(s)\n`);

  const section = (title, list, render) => {
    if (!list.length) return;
    console.log(`${title} (${list.length})`);
    list.forEach(render);
    console.log();
  };

  section("UNKNOWN FEATURE — never selected by anything", unknownFeature, (a) =>
    console.log(
      `    ${a.id}  ${a.company.padEnd(24)} feature="${a.feature}"  ${a.host}  ${a.userName}`
    )
  );

  section("CUSTOM HOST WITH NO HOSTNAME — cannot connect", blankCustomHost, (a) =>
    console.log(`    ${a.id}  ${a.company.padEnd(24)} ${a.userName}`)
  );

  section("NO PASSWORD SET — cannot authenticate", noPassword, (a) =>
    console.log(
      `    ${a.id}  ${a.company.padEnd(24)} ${a.host}  ${a.userName}`
    )
  );

  section("DUPLICATE FEATURE — only one is ever used", duplicateFeature, (d) => {
    console.log(`    ${d.company} — feature "${d.feature}"`);
    d.accounts.forEach((a) =>
      console.log(
        `        ${a.id}  ${a.host.padEnd(28)} ${a.userName}` +
          `${a.isPrimary ? "  (primary)" : ""}${a.isActive ? "" : "  (inactive)"}`
      )
    );
  });

  const problems =
    unknownFeature.length +
    blankCustomHost.length +
    noPassword.length +
    duplicateFeature.length;

  if (!problems) {
    console.log("Nothing wrong. Every account is usable.");
  } else {
    console.log(
      `${problems} problem group(s). Each one is an account that looks ` +
        `configured in the UI but cannot send.`
    );
  }

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exitCode = 1;
});
