/**
 * Delete employee document records and the objects they reference.
 *
 * For clearing out test data. Removes the `documents` collection's records and
 * every S3 object those records point at — and nothing else. Media rows, QR
 * images, branding and expense receipts are left alone; they are not employee
 * documents, and a purge that quietly took them too would be the kind of
 * surprise this script exists to avoid.
 *
 * Scoped to one company with --tenant. Without it, every company's documents go,
 * which on a multi-tenant install is almost never what is meant — so it has to
 * be asked for explicitly with --all-tenants.
 *
 * Usage:
 *   node scripts/purge-documents.mjs --dry-run
 *   node scripts/purge-documents.mjs --tenant <tenantId>
 *   node scripts/purge-documents.mjs --all-tenants
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { writeFileSync } from "node:fs";
import { S3Client, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

dotenv.config();

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ALL_TENANTS = args.includes("--all-tenants");

function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || i === args.length - 1) return undefined;
  const v = args[i + 1];
  return v.startsWith("--") ? undefined : v;
}

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_ID,
    secretAccessKey: process.env.AWS_ACCESS_PORTAL_KEY,
  },
});
const Bucket = process.env.AWS_BUCKET_NAME;

async function main() {
  if (!process.env.MONGO_DB_URL) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const tenantId = flag("tenant");
  if (!tenantId && !ALL_TENANTS) {
    console.error(
      "Refusing to purge every company's documents by accident.\n" +
        "Pass --tenant <id> for one company, or --all-tenants to mean it."
    );
    process.exitCode = 1;
    return;
  }
  if (tenantId && !mongoose.isValidObjectId(tenantId)) {
    console.error(`--tenant "${tenantId}" is not a valid id.`);
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(process.env.MONGO_DB_URL, {
    serverSelectionTimeoutMS: 10000,
  });
  const db = mongoose.connection.db;
  const col = db.collection("documents");

  const filter = tenantId
    ? { tenantId: new mongoose.Types.ObjectId(tenantId) }
    : {};
  const docs = await col.find(filter).toArray();

  console.log(
    `${DRY_RUN ? "DRY RUN — nothing will be deleted\n" : ""}` +
      `Database: ${db.databaseName}   Bucket: ${Bucket}\n` +
      `Scope: ${tenantId ? `company ${tenantId}` : "EVERY company"}\n`
  );

  const keys = [];
  for (const d of docs) {
    for (const f of d.documentsFiles || []) if (f.key) keys.push(f.key);
  }

  console.log(`  document records : ${docs.length}`);
  console.log(`  objects they reference: ${keys.length}`);
  keys.forEach((k) => console.log(`    ${k}`));

  if (!docs.length) {
    console.log("\nNothing to purge.");
    await mongoose.disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log("\nDry run — nothing deleted.");
    await mongoose.disconnect();
    return;
  }

  // Written before anything is removed, so a mistaken purge is recoverable at
  // least as far as the records go.
  const path = `documents-purge-backup-${Date.now()}.json`;
  writeFileSync(path, JSON.stringify(docs, null, 2));
  console.log(`\n  backed up ${docs.length} record(s) to ${path}`);

  let deletedObjects = 0;
  for (const key of keys) {
    try {
      // HEAD first so a key that is already gone is reported as such rather
      // than counted as a deletion that happened.
      await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
      deletedObjects++;
      console.log(`  deleted object ${key}`);
    } catch {
      console.log(`  not in bucket, skipped ${key}`);
    }
  }

  const res = await col.deleteMany(filter);
  console.log(
    `\n  records deleted: ${res.deletedCount}` +
      `\n  objects deleted: ${deletedObjects}`
  );
  console.log("\nDone.");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Purge failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
