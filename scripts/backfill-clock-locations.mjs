/**
 * Give every clock record a real place.
 *
 * Until now a record said `locationType: "office"` with `siteId: null`, so
 * every office in a company was the same null — two offices indistinguishable,
 * unreportable, and impossible to record an employee at both of on one day
 * (the old unique index keyed on siteId, so the second write collided with the
 * first). See CLOCK_LOCATION_PLAN.md §3.
 *
 * WHAT THIS DOES, per company:
 *   1. one ClockLocation per active ProjectSite, named after the site
 *   2. one default office location, if the company has none
 *   3. locationId written onto every clock record, from its siteId
 *   4. the old (tenantId, employeeId, date, siteId) unique index dropped and
 *      the new (…, locationId) one built — IN THAT ORDER
 *
 * Step 4 is why the order matters. Building the new index first would compare
 * records that all still have a null locationId, and collide every employee's
 * second record of the same day against their first.
 *
 * WHAT IT CANNOT DO: split historical office records between Office 1 and
 * Office 2. Which office a record happened at was never stored — it is not
 * recoverable, by this script or any other. Everything before the cutover
 * lands in one default office. Tell whoever reads the reports.
 *
 * NOTHING IS DELETED and no times are touched. Only locationId is written.
 *
 * Usage:
 *   node scripts/backfill-clock-locations.mjs                 # dry run
 *   node scripts/backfill-clock-locations.mjs --apply
 *   node scripts/backfill-clock-locations.mjs --apply --tenant <tenantId>
 *
 * Run scripts/dedupe-clock-records.mjs first if it has never been run: this
 * rebuilds a unique index, and an index does not build over duplicates.
 *
 * Talks to the driver directly rather than through the models, so it sees every
 * tenant regardless of TENANT_ENFORCEMENT.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { writeFileSync } from "node:fs";

dotenv.config();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || i === args.length - 1) return undefined;
  const v = args[i + 1];
  return v.startsWith("--") ? undefined : v;
}

const OLD_INDEX = "tenantId_1_employeeId_1_date_1_siteId_1";
const NEW_INDEX = "tenantId_1_employeeId_1_date_1_locationId_1";

async function main() {
  if (!process.env.MONGO_DB_URL) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const tenantArg = flag("tenant");
  await mongoose.connect(process.env.MONGO_DB_URL);
  const db = mongoose.connection.db;

  const records = db.collection("clockrecords");
  const locations = db.collection("clocklocations");
  const sites = db.collection("projectsites");

  // Every tenant that actually has clock records, plus any with sites — a
  // company with sites but no attendance yet still wants its locations.
  const tenantIds = tenantArg
    ? [new mongoose.Types.ObjectId(String(tenantArg))]
    : [
        ...new Set(
          [
            ...(await records.distinct("tenantId")),
            ...(await sites.distinct("tenantId")),
          ]
            .filter(Boolean)
            .map(String),
        ),
      ].map((id) => new mongoose.Types.ObjectId(id));

  const plan = { tenants: [], createdLocations: 0, recordsToStamp: 0 };

  for (const tenantId of tenantIds) {
    const scope = { tenantId };
    const summary = {
      tenantId: String(tenantId),
      newLocations: [],
      defaultLocation: null,
      siteRecords: 0,
      officeRecords: 0,
      orphanSiteIds: [],
    };

    // --- 1. a location per site -------------------------------------------
    const tenantSites = await sites.find(scope).toArray();
    const existing = await locations.find(scope).toArray();
    const bySite = new Map(
      existing.filter((l) => l.projectSiteId).map((l) => [String(l.projectSiteId), l]),
    );

    for (const site of tenantSites) {
      if (bySite.has(String(site._id))) continue;
      const doc = {
        tenantId,
        name: site.siteName || `Site ${String(site._id).slice(-6)}`,
        kind: "site",
        projectSiteId: site._id,
        isDefault: false,
        networks: [],
        methods: [],
        requireAll: false,
        isActive: site.isActive !== false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      summary.newLocations.push({ name: doc.name, siteId: String(site._id) });
      if (APPLY) {
        try {
          const res = await locations.insertOne(doc);
          bySite.set(String(site._id), { ...doc, _id: res.insertedId });
        } catch (error) {
          // One site that cannot be represented must not abort the run and
          // leave the migration half-applied. Record it and carry on; the
          // records for that site stay unstamped and the summary says so.
          if (error?.code !== 11000) throw error;
          summary.failedSites = summary.failedSites || [];
          summary.failedSites.push({
            siteId: String(site._id),
            name: doc.name,
            reason: error?.errmsg || "duplicate",
          });
          console.log(`  SKIPPED  "${doc.name}" — ${error?.code} on insert`);
        }
      } else {
        bySite.set(String(site._id), { ...doc, _id: null });
      }
    }

    // --- 2. the default office --------------------------------------------
    let defaultLocation = existing.find((l) => l.isDefault);

    // Adopt an office the company has already named rather than inventing a
    // second one beside it — see ensureDefaultLocation() for why that matters.
    if (!defaultLocation) {
      const offices = existing.filter(
        (l) => !l.projectSiteId && l.isActive !== false,
      );
      if (offices.length === 1) {
        defaultLocation = { ...offices[0], isDefault: true };
        console.log(
          `  adopting existing office "${offices[0].name}" as the default`,
        );
        if (APPLY) {
          await locations.updateOne(
            { _id: offices[0]._id },
            { $set: { isDefault: true } },
          );
        }
      }
    }

    if (!defaultLocation) {
      const doc = {
        tenantId,
        name: "Head Office",
        kind: "office",
        projectSiteId: null,
        isDefault: true,
        networks: [],
        methods: [],
        requireAll: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      summary.newLocations.push({ name: doc.name, siteId: null });
      if (APPLY) {
        const res = await locations.insertOne(doc);
        defaultLocation = { ...doc, _id: res.insertedId };
      } else {
        defaultLocation = { ...doc, _id: null };
      }
    }
    summary.defaultLocation = defaultLocation.name;

    // --- 3. stamp the records ---------------------------------------------
    summary.officeRecords = await records.countDocuments({
      ...scope,
      locationId: null,
      $or: [{ siteId: null }, { siteId: { $exists: false } }],
    });

    if (APPLY && summary.officeRecords) {
      await records.updateMany(
        {
          ...scope,
          locationId: null,
          $or: [{ siteId: null }, { siteId: { $exists: false } }],
        },
        { $set: { locationId: defaultLocation._id } },
      );
    }

    for (const [siteIdStr, location] of bySite) {
      const siteOid = new mongoose.Types.ObjectId(siteIdStr);
      const n = await records.countDocuments({
        ...scope,
        siteId: siteOid,
        locationId: null,
      });
      if (!n) continue;
      summary.siteRecords += n;
      if (APPLY) {
        await records.updateMany(
          { ...scope, siteId: siteOid, locationId: null },
          { $set: { locationId: location._id } },
        );
      }
    }

    // A record pointing at a site that no longer exists. Rather than leave it
    // unstamped — which would block the unique index — it goes to the default
    // and is reported, because a site that was deleted is still a place
    // somebody worked.
    //
    // The exclusion matters in a dry run: nothing has been stamped yet, so
    // without it every site record looks orphaned and the summary reports
    // "3 deleted-site groups" where there is really one.
    const knownSiteOids = [...bySite.keys()].map(
      (id) => new mongoose.Types.ObjectId(id),
    );
    const orphans = await records
      .aggregate([
        {
          $match: {
            ...scope,
            locationId: null,
            siteId: { $ne: null, $nin: knownSiteOids },
          },
        },
        { $group: { _id: "$siteId", n: { $sum: 1 } } },
      ])
      .toArray();

    for (const o of orphans) {
      summary.orphanSiteIds.push({ siteId: String(o._id), records: o.n });
      if (APPLY) {
        await records.updateMany(
          { ...scope, locationId: null, siteId: o._id },
          { $set: { locationId: defaultLocation._id } },
        );
      }
    }

    plan.createdLocations += summary.newLocations.length;
    plan.recordsToStamp += summary.officeRecords + summary.siteRecords;
    plan.tenants.push(summary);
  }

  const backup = `clock-locations-backfill-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify(plan, null, 2));

  console.log(
    `\n${plan.tenants.length} tenant(s): ` +
      `${plan.createdLocations} location(s) to create, ` +
      `${plan.recordsToStamp} record(s) to stamp`,
  );
  console.log(`Full plan written to ${backup}\n`);

  for (const t of plan.tenants.slice(0, 10)) {
    console.log(
      `  tenant ${t.tenantId}: +${t.newLocations.length} locations, ` +
        `${t.officeRecords} office + ${t.siteRecords} site records` +
        (t.orphanSiteIds.length
          ? `, ${t.orphanSiteIds.length} deleted-site group(s) -> ${t.defaultLocation}`
          : ""),
    );
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write these changes.");
    await mongoose.disconnect();
    return;
  }

  // --- 4. swap the indexes, and only now ----------------------------------
  const unstamped = await records.countDocuments({
    locationId: null,
    isDeleted: { $ne: true },
  });
  if (unstamped > 0) {
    console.log(
      `\n${unstamped} live record(s) still have no locationId — NOT swapping ` +
        `the index. Re-run, or investigate those records first.`,
    );
    await mongoose.disconnect();
    return;
  }

  const current = await records.indexes();
  if (current.some((i) => i.name === OLD_INDEX)) {
    await records.dropIndex(OLD_INDEX);
    console.log(`\nDropped ${OLD_INDEX}`);
  }
  if (!current.some((i) => i.name === NEW_INDEX)) {
    await records.createIndex(
      { tenantId: 1, employeeId: 1, date: 1, locationId: 1 },
      { unique: true, partialFilterExpression: { isDeleted: false } },
    );
    console.log(`Built ${NEW_INDEX}`);
  }

  console.log(
    "\nDone. Every clock record now names a place, and an employee can be " +
      "recorded at two locations on the same day.\n" +
      "Historical office records are all in the default office — which office " +
      "they actually happened at was never stored.",
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
