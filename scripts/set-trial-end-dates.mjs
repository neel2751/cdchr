/**
 * Give an end date to every trial that does not have one.
 *
 * Self sign-ups start on "trial", but until lib/tenantAccess.js there was no
 * end date, so a trial never ended. New sign-ups get one; this is for the
 * companies that signed up before. They are treated as a trial with no end
 * (full access) until this runs — nothing is locked by deploying the code.
 *
 * Each gets the full trial from TODAY, not from when they signed up: a company
 * that signed up two months ago would otherwise be locked the moment this ran,
 * with no warning. Paying companies ("active") are never touched.
 *
 * Usage:
 *   node scripts/set-trial-end-dates.mjs            # dry run: lists them
 *   node scripts/set-trial-end-dates.mjs --apply
 *   node scripts/set-trial-end-dates.mjs --apply --days 30
 *
 * Talks to the driver directly; the companies collection has no tenant scope.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const daysArg = args.indexOf("--days");
const DAYS = daysArg === -1 ? 14 : parseInt(args[daysArg + 1], 10);

async function main() {
  if (!process.env.MONGO_DB_URL) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(DAYS) || DAYS < 1) {
    console.error("--days must be a whole number of days, 1 or more.");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(process.env.MONGO_DB_URL);
  const companies = mongoose.connection.db.collection("companies");

  const open = {
    status: "trial",
    delete: { $ne: true },
    $or: [
      { "billing.trialEndsAt": { $exists: false } },
      { "billing.trialEndsAt": null },
    ],
  };
  const found = await companies
    .find(open)
    .project({ name: 1, slug: 1, createdAt: 1 })
    .toArray();

  const end = new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000);
  console.log(
    `${found.length} trial(s) with no end date. Each would end on ${end.toDateString()} (${DAYS} days from today).`
  );
  for (const c of found) {
    const since = c.createdAt ? new Date(c.createdAt).toDateString() : "unknown";
    console.log(`  - ${c.name} (${c.slug || "no slug"}), signed up ${since}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Nothing changed. Add --apply to set the dates.");
  } else if (found.length) {
    const res = await companies.updateMany(open, {
      $set: { "billing.trialEndsAt": end },
    });
    console.log(`\nSet ${res.modifiedCount} end date(s).`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
