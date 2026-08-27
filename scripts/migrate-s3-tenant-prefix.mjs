/**
 * Move existing S3 objects under their company's prefix.
 *
 * Keys written before Phase 7 look like `{employeeId}/{file}` — one flat
 * namespace shared by every company. The application now refuses cross-tenant
 * access for these by checking the record that references them, but that only
 * works while a record exists; anything orphaned is unreachable and
 * unattributable, and per-company export, deletion and storage totals cannot be
 * prefix operations until every object is moved.
 *
 * Order per object: copy, update the record, delete the original. A failure
 * therefore leaves a duplicate rather than a record pointing at nothing.
 *
 * --prune-missing removes references to objects that are not in the bucket.
 * Use it when the old storage is genuinely gone: the records otherwise offer
 * downloads that can only 404. It removes the *file reference*, never the
 * business record around it — an expense keeps its amount and approval, it just
 * stops claiming to have a receipt. Affected records are written to a JSON
 * backup first.
 *
 * Usage:
 *   node scripts/migrate-s3-tenant-prefix.mjs --dry-run
 *   node scripts/migrate-s3-tenant-prefix.mjs
 *   node scripts/migrate-s3-tenant-prefix.mjs --limit 50
 *   node scripts/migrate-s3-tenant-prefix.mjs --prune-missing --dry-run
 *   node scripts/migrate-s3-tenant-prefix.mjs --prune-missing
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { writeFileSync } from "node:fs";
import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

dotenv.config();

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const PRUNE = args.includes("--prune-missing");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i === -1 ? Infinity : parseInt(args[i + 1], 10) || Infinity;
})();

const Bucket = process.env.AWS_BUCKET_NAME;
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_ID,
    secretAccessKey: process.env.AWS_ACCESS_PORTAL_KEY,
  },
});

/**
 * Every place a key is recorded, and how to rewrite it.
 *
 * Driven by the records rather than by listing the bucket: an object nothing
 * references has no company to be moved to, and guessing would be worse than
 * leaving it. Those are reported at the end instead.
 */
const SOURCES = [
  {
    collection: "documents",
    arrayField: "documentsFiles",
    category: "documents",
  },
  { collection: "media", keyField: "key", category: "media" },
  { collection: "expenses", arrayField: "receipt", category: "expenses/receipts" },
];

function newKey(tenantId, category, oldKey) {
  // Keep the tail of the old key so filenames stay recognisable.
  const tail = oldKey.split("/").filter(Boolean).join("/");
  return `tenants/${tenantId}/${category}/${tail}`;
}

async function objectExists(Key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket, Key }));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!process.env.MONGO_DB_URL) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }
  if (!Bucket || !process.env.AWS_ACCESS_ID) {
    console.error("AWS credentials or bucket are not configured.");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(process.env.MONGO_DB_URL, {
    serverSelectionTimeoutMS: 10000,
  });
  const db = mongoose.connection.db;
  console.log(
    `${DRY_RUN ? "DRY RUN — nothing will be written\n" : ""}Bucket: ${Bucket}\n`
  );

  const stats = { already: 0, moved: 0, missing: 0, noTenant: 0, failed: 0, pruned: 0 };
  // Everything about to be changed, kept so a mistaken prune can be undone.
  const backup = [];

  for (const src of SOURCES) {
    const col = db.collection(src.collection);
    const docs = await col.find({}).toArray();
    if (!docs.length) continue;
    console.log(`${src.collection} (${docs.length} records)`);

    for (const doc of docs) {
      if (stats.moved >= LIMIT) break;

      if (!doc.tenantId) {
        stats.noTenant++;
        continue;
      }
      const tenantId = String(doc.tenantId);

      const entries = src.arrayField
        ? (doc[src.arrayField] || []).map((f, i) => ({ key: f?.key, index: i }))
        : [{ key: doc[src.keyField], index: null }];

      for (const entry of entries) {
        if (!entry.key) continue;
        if (entry.key.startsWith("tenants/")) {
          stats.already++;
          continue;
        }

        const target = newKey(tenantId, src.category, entry.key);

        // The dry run checks the bucket too. It previously reported "would
        // move N" purely from the records, so it looked healthy even when not
        // one of those objects was present — exactly the case that matters
        // before committing to a migration.
        const present = await objectExists(entry.key);

        if (DRY_RUN) {
          if (present) {
            console.log(`       ${entry.key}\n    -> ${target}`);
            stats.moved++;
          } else {
            stats.missing++;
            if (PRUNE) {
              console.log(
                `  would prune ${src.collection} ${doc._id}` +
                  `\n    ${entry.key}` +
                  `\n    (${src.arrayField ? "removes this file from the record" : "deletes the media row"})`
              );
              stats.pruned++;
            } else {
              console.log(`  MISSING ${entry.key}\n    -> ${target}`);
            }
          }
          continue;
        }

        if (!present) {
          stats.missing++;

          if (!PRUNE) {
            // Rewriting the key would only relocate a dangling reference.
            console.log(`  MISSING in bucket, left as-is: ${entry.key}`);
            continue;
          }

          backup.push({
            collection: src.collection,
            _id: String(doc._id),
            key: entry.key,
            record: doc,
          });

          if (src.arrayField) {
            // Pull just this file out of the array. The record itself — an
            // expense, an employee's document set — is a business record and
            // stays.
            await col.updateOne(
              { _id: doc._id },
              { $pull: { [src.arrayField]: { key: entry.key } } }
            );
          } else {
            // A media row IS the file, so nothing survives it.
            await col.deleteOne({ _id: doc._id });
          }

          console.log(`  pruned dangling reference: ${entry.key}`);
          stats.pruned++;
          continue;
        }

        try {
          // 1. copy
          await s3.send(
            new CopyObjectCommand({
              Bucket,
              CopySource: `${Bucket}/${encodeURIComponent(entry.key)}`,
              Key: target,
            })
          );
          // 2. point the record at the new key
          const field = src.arrayField
            ? `${src.arrayField}.${entry.index}.key`
            : src.keyField;
          await col.updateOne({ _id: doc._id }, { $set: { [field]: target } });
          // 3. only now remove the original
          await s3.send(new DeleteObjectCommand({ Bucket, Key: entry.key }));

          console.log(`  moved ${entry.key}\n     -> ${target}`);
          stats.moved++;
        } catch (error) {
          console.error(`  FAILED ${entry.key}: ${error.message}`);
          stats.failed++;
        }
      }
    }
  }

  if (!PRUNE && stats.missing && stats.missing === stats.moved + stats.missing) {
    console.log(
      "\nNOT ONE recorded object was found in this bucket. Either the wrong\n" +
        "bucket is configured, or these files live elsewhere. Migrating now would\n" +
        "do nothing; check AWS_BUCKET_NAME before going further."
    );
  }

  console.log(
    `\nalready prefixed : ${stats.already}` +
      `\n${DRY_RUN ? "would move" : "moved"}       : ${stats.moved}` +
      `\nmissing in bucket: ${stats.missing}` +
      (PRUNE ? `\npruned references: ${stats.pruned}` : "") +
      `\nrecords with no company: ${stats.noTenant}` +
      `\nfailed           : ${stats.failed}`
  );

  if (stats.noTenant) {
    console.log(
      "\nRecords with no company cannot be placed. Run scripts/backfill-tenant.mjs first."
    );
  }

  if (PRUNE && backup.length) {
    const path = `s3-prune-backup-${Date.now()}.json`;
    writeFileSync(path, JSON.stringify(backup, null, 2));
    console.log(`\nBacked up ${backup.length} affected record(s) to ${path}`);
  }

  console.log(DRY_RUN ? "\nDry run — nothing written." : "\nDone.");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Migration failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
