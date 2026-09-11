/**
 * Find people who exist more than once.
 *
 * An email is how someone signs in, and the login lookup searches every account
 * collection across every tenant. So two records sharing an email are two
 * candidates for one login — and until the fix in server/authServer/authServer.js
 * the winner was whichever the storage engine returned first, with no sort.
 *
 * This normally means the same person was created in two companies, which is
 * what customers do when they use a company to stand in for a branch. See
 * BRANCHES_PLAN.md.
 *
 * Read-only. It writes nothing and is safe against production.
 *
 *   node scripts/find-duplicate-emails.mjs
 *   node scripts/find-duplicate-emails.mjs --json > duplicates.json
 *
 * Once the report is empty, set DUPLICATE_LOGIN_POLICY=block so a new duplicate
 * is refused at the door rather than silently picking a company.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const AS_JSON = process.argv.includes("--json");

// Every collection the login lookup searches, in the order it searches them.
const SOURCES = [
  { label: "office", collection: "officeemployes", name: ["name"] },
  { label: "site", collection: "employes", name: ["firstName", "lastName"] },
  { label: "reception", collection: "officeusers", name: ["name"] },
  { label: "platform", collection: "platformusers", name: ["name"] },
];

const displayName = (doc, fields) =>
  fields
    .map((f) => doc[f])
    .filter(Boolean)
    .join(" ") || "(no name)";

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

  // email (lowercased) -> accounts. Lowercased because the login lookup is
  // case-sensitive for tenant accounts but not for platform users, so
  // "Bob@x.com" and "bob@x.com" are already two records that behave as one
  // person to a human and inconsistently to the app.
  const byEmail = new Map();

  for (const source of SOURCES) {
    const rows = await db
      .collection(source.collection)
      .find(
        { delete: { $ne: true }, email: { $type: "string", $ne: "" } },
        {
          projection: {
            email: 1,
            tenantId: 1,
            isActive: 1,
            ...Object.fromEntries(source.name.map((f) => [f, 1])),
          },
        }
      )
      .toArray();

    for (const row of rows) {
      const key = String(row.email).trim().toLowerCase();
      if (!byEmail.has(key)) byEmail.set(key, []);
      byEmail.get(key).push({
        source: source.label,
        collection: source.collection,
        id: String(row._id),
        email: row.email,
        name: displayName(row, source.name),
        tenantId: row.tenantId ? String(row.tenantId) : null,
        company: row.tenantId
          ? companyName.get(String(row.tenantId)) || "(unknown company)"
          : "(no company)",
        isActive: row.isActive !== false,
      });
    }
  }

  const duplicates = [...byEmail.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([email, rows]) => ({
      email,
      count: rows.length,
      // The distinction that matters: the same person in two companies is the
      // branch workaround, whereas two rows in ONE company is straightforward
      // data entry duplication and safe to merge without deciding anything.
      crossTenant:
        new Set(rows.map((r) => r.tenantId).filter(Boolean)).size > 1,
      // Which record the login would now choose: source order, then oldest id.
      wouldSignInAs: [...rows].sort(
        (a, b) =>
          SOURCES.findIndex((s) => s.label === a.source) -
            SOURCES.findIndex((s) => s.label === b.source) ||
          a.id.localeCompare(b.id)
      )[0],
      rows,
    }))
    .sort((a, b) => Number(b.crossTenant) - Number(a.crossTenant) || b.count - a.count);

  if (AS_JSON) {
    console.log(JSON.stringify({ database: db.databaseName, duplicates }, null, 2));
    await mongoose.disconnect();
    return;
  }

  console.log(`Database: ${db.databaseName}\n`);

  if (!duplicates.length) {
    console.log("No duplicate emails. Safe to set DUPLICATE_LOGIN_POLICY=block.");
    await mongoose.disconnect();
    return;
  }

  const crossTenant = duplicates.filter((d) => d.crossTenant);

  for (const dup of duplicates) {
    console.log(
      `${dup.crossTenant ? "ACROSS COMPANIES" : "same company   "}  ${dup.email}  (${dup.count} records)`
    );
    for (const row of dup.rows) {
      const chosen = row.id === dup.wouldSignInAs.id ? " <- signs in as this" : "";
      console.log(
        `    ${row.source.padEnd(9)} ${row.id}  ${row.company.padEnd(24)} ` +
          `${row.name}${row.isActive ? "" : " (inactive)"}${chosen}`
      );
    }
    console.log();
  }

  console.log(`${duplicates.length} duplicated email(s).`);
  console.log(
    `${crossTenant.length} span more than one company — these are the ones that ` +
      `put someone in the wrong company's records.\n`
  );
  console.log(
    "Fix by merging each person to a single record, then set " +
      "DUPLICATE_LOGIN_POLICY=block."
  );

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exitCode = 1;
});
