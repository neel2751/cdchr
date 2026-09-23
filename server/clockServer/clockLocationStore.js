/**
 * Resolving a scan to the place it happened.
 *
 * NOT a "use server" module — these are internal helpers called from the clock
 * actions, and `ensureDefaultLocation` creates records.
 *
 * Every clock-in now names a location. Codes still carry a `siteId` (that is
 * what the reception screen mints and what `SiteAssignment` rosters against),
 * so this is the seam: site id in, location out.
 */
import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import ClockLocationModel from "@/models/clockLocationModel";

/**
 * The company's default location — where a scan with no site belongs.
 *
 * Created on first use rather than required up front, so a company that has
 * never opened the locations screen still records office attendance somewhere
 * real instead of against a null. `isDefault` is uniquely indexed, so a race
 * between two first-ever scans ends with one document, not two.
 */
export async function ensureDefaultLocation() {
  await connect();

  const existing = await ClockLocationModel.findOne({ isDefault: true }).lean();
  if (existing) return existing;

  // A company that has already named its office should not then be given a
  // second one called "Head Office". If exactly one office location exists and
  // none is marked default, adopt it — inventing a duplicate would split their
  // office attendance across two places, and reassignment is deliberately not
  // retroactive, so it would not be tidy-uppable afterwards.
  const offices = await ClockLocationModel.find({
    projectSiteId: null,
    isActive: true,
  })
    .limit(2)
    .lean();
  if (offices.length === 1) {
    await ClockLocationModel.updateOne(
      { _id: offices[0]._id },
      { $set: { isDefault: true } },
    );
    return { ...offices[0], isDefault: true };
  }

  try {
    const created = await ClockLocationModel.create({
      name: "Head Office",
      kind: "office",
      isDefault: true,
    });
    return created.toObject();
  } catch (error) {
    // Lost the race, or a location called "Head Office" already exists. Either
    // way the answer is whatever is there now.
    if (error?.code === 11000) {
      return (
        (await ClockLocationModel.findOne({ isDefault: true }).lean()) ||
        (await ClockLocationModel.findOne({ name: "Head Office" }).lean())
      );
    }
    throw error;
  }
}

/**
 * Which location does a scan at this site belong to?
 *
 * @param siteId the ProjectSite from the scanned code, or null for an office.
 * @returns the location document, or null if the site has no location yet.
 */
export async function resolveLocationForSite(siteId) {
  await connect();

  if (!siteId) return ensureDefaultLocation();
  if (!isValidObjectId(siteId)) return null;

  const bySite = await ClockLocationModel.findOne({
    projectSiteId: createObjectId(siteId),
    isActive: true,
  }).lean();

  return bySite || null;
}

/**
 * Is this name already an office's?
 *
 * The unique index only covers offices (models/clockLocationModel.js explains
 * why: two sites may legitimately share a name). That leaves one gap it cannot
 * close — a *site* named onto an *office's* name, which the index does not see
 * because site rows are not in it.
 *
 * That gap is worth closing by hand. An office name is one a person typed, and
 * the default office is where every untagged historical record lives; a site
 * quietly shadowing it in a picker is the exact ambiguity this model exists to
 * remove. Site-vs-site repeats are fine and are left alone.
 *
 * @param exceptId a location allowed to keep its own name (for renames).
 */
export async function officeNameTaken(name, exceptId = null) {
  const trimmed = (name || "").trim();
  if (!trimmed) return false;

  const clash = await ClockLocationModel.findOne({
    name: trimmed,
    projectSiteId: null,
    isActive: true,
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  })
    .select("_id")
    .lean();

  return Boolean(clash);
}

/**
 * Keep a site's clock-in location in step with the site.
 *
 * A site and a location are not the same thing, which is why this is a sync
 * rather than a merge:
 *
 *   A **site** is a job. It has a type, a status, a start and an end date; it
 *   is what people are rostered to, what expenses are booked against, and what
 *   eventually reads "Completed".
 *
 *   A **location** is a place. It has coordinates, a network, a QR screen, NFC
 *   tags. An office is one and has no job attached at all — which is exactly
 *   the gap that made two offices indistinguishable.
 *
 * They are usually one-to-one, so renaming ProjectSite to Location would look
 * tempting; it would also drag siteAssignment, expenses, rota and reporting
 * along with it, and it would still leave offices homeless.
 *
 * So both exist, and the admin never maintains two lists: creating a site
 * creates its location, renaming a site renames it, archiving a site archives
 * it. The only thing anyone creates by hand on the locations screen is an
 * office.
 *
 * Never throws. A location that cannot be synced must not stop a site being
 * saved — the site is the record that matters, and the location catches up on
 * the next scan via resolveOrCreateLocationForSite.
 */
export async function syncLocationForSite(siteId, { name, isActive } = {}) {
  try {
    if (!siteId || !isValidObjectId(siteId)) return;
    await connect();

    const oid = createObjectId(siteId);
    const existing = await ClockLocationModel.findOne({ projectSiteId: oid });

    if (!existing) {
      const wanted = name || `Site ${String(siteId).slice(-6)}`;
      await ClockLocationModel.create({
        // A new site landing on an office's name gets a distinguishable one
        // rather than no location at all — without a location it cannot be
        // clocked in at.
        name: (await officeNameTaken(wanted))
          ? `${wanted} (Site ${String(siteId).slice(-4)})`
          : wanted,
        kind: "site",
        projectSiteId: oid,
        isActive: isActive !== false,
      });
      return;
    }

    const changes = {};
    // A rename onto an office's name is dropped; the rest of the sync still
    // applies, so archiving a site still archives its location.
    if (name && name !== existing.name && !(await officeNameTaken(name))) {
      changes.name = name;
    }
    if (isActive !== undefined && isActive !== existing.isActive) {
      changes.isActive = isActive;
    }
    if (Object.keys(changes).length) {
      await ClockLocationModel.updateOne({ _id: existing._id }, { $set: changes });
    }
  } catch (error) {
    // A duplicate name is the likely one: a site renamed to match an office.
    // The location keeps its old name, which is visible and fixable, rather
    // than the save failing.
    console.log("Could not sync location for site:", error?.message);
  }
}

/**
 * The same question, but never answering "nowhere".
 *
 * A site with no location row yet gets one, named after the site. Phase A runs
 * a backfill that creates these up front; this covers a site added afterwards,
 * so adding a site never silently breaks clocking at it.
 */
export async function resolveOrCreateLocationForSite(siteId, siteName) {
  const found = await resolveLocationForSite(siteId);
  if (found) return found;
  if (!siteId || !isValidObjectId(siteId)) return ensureDefaultLocation();

  try {
    const created = await ClockLocationModel.create({
      name: siteName || `Site ${String(siteId).slice(-6)}`,
      kind: "site",
      projectSiteId: createObjectId(siteId),
    });
    return created.toObject();
  } catch (error) {
    if (error?.code === 11000) return resolveLocationForSite(siteId);
    throw error;
  }
}
