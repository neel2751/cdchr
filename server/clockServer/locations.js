"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { withAudit, recordAudit } from "@/lib/audit";
import ClockLocationModel from "@/models/clockLocationModel";
import ProjectSiteModel from "@/models/siteProjectModel";
import { officeNameTaken } from "./clockLocationStore";
import { getServerSideProps } from "../session/session";

/**
 * Managing the places people clock in at.
 *
 * Phase A only: create, rename, archive. The geofence and network fields exist
 * on the model but nothing reads them yet — turning them into policy is Phase
 * B/D, and shipping the editor before the enforcement would let someone set a
 * radius that silently does nothing.
 */

/** Only a super admin decides what counts as a place of work. */
async function requireSuperAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { ok: false, message: "Not signed in" };
  if (user.role !== "superAdmin") {
    return { ok: false, message: "Not authorized" };
  }
  return { ok: true, user };
}

/**
 * Every location, with the site each one maps to.
 *
 * Readable by any signed-in admin: it is the list a roster and an attendance
 * filter are built from, not privileged information.
 *
 * Takes no arguments, deliberately.
 *
 * `useFetchSelectQuery` calls its fetchFn as `fetchFn(signal)` — the query's
 * AbortSignal, which reaches a server action as an opaque client reference.
 * Reading a property off it throws *on the server*:
 *
 *   Cannot access includeArchived on the server. You cannot dot into a
 *   temporary client reference from a server component.
 *
 * ...which fails the query, so the card renders its loading state for ever and
 * the add form never appears. Destructuring an options object here looks
 * harmless and is not. An action that needs parameters belongs on
 * `useFetchQuery`, which passes `params` instead.
 */
export async function getClockLocations() {
  try {
    await connect();
    const rows = await ClockLocationModel.find({ isActive: true })
      .sort({ isDefault: -1, kind: 1, name: 1 })
      .populate({ path: "projectSiteId", select: "siteName" })
      .lean();

    return { success: true, data: JSON.stringify(rows) };
  } catch (error) {
    console.log("Error loading clock locations:", error);
    return { success: false, message: "Could not load locations" };
  }
}

/**
 * The same list, archived places included.
 *
 * Separate from `getClockLocations` rather than a parameter, because every
 * other caller is a picker — the QR screen, the tag editor, the rules editor —
 * and offering an archived place to clock in at would be wrong in all of them.
 * Only the management table wants the full list.
 *
 * It wants it because the two screens otherwise disagree: Site Projects lists
 * every site regardless of state, this listed only active ones, and a company
 * with ten sites saw seven here with nothing explaining the gap. An archived
 * location is not missing, it is closed — and it has to be visible to say so.
 */
export async function getAllClockLocations() {
  try {
    await connect();
    const rows = await ClockLocationModel.find({})
      .sort({ isDefault: -1, isActive: -1, kind: 1, name: 1 })
      .populate({ path: "projectSiteId", select: "siteName isActive" })
      .lean();

    return { success: true, data: JSON.stringify(rows) };
  } catch (error) {
    console.log("Error loading clock locations:", error);
    return { success: false, message: "Could not load locations" };
  }
}

export const createClockLocation = withAudit(
  "ClockLocation.create",
  async ({ name, kind = "office", projectSiteId = null } = {}) => {
    try {
      const auth = await requireSuperAdmin();
      if (!auth.ok) return { success: false, message: auth.message };

      const trimmed = (name || "").trim();
      if (!trimmed) return { success: false, message: "Name is required" };
      if (!["office", "site"].includes(kind)) {
        return { success: false, message: "Invalid location type" };
      }
      if (projectSiteId && !isValidObjectId(projectSiteId)) {
        return { success: false, message: "Invalid site" };
      }

      await connect();

      // One location per site. Two would split that site's attendance in half
      // with no way to tell which half is which.
      if (projectSiteId) {
        const taken = await ClockLocationModel.findOne({
          projectSiteId: createObjectId(projectSiteId),
          isActive: true,
        })
          .select("name")
          .lean();
        if (taken) {
          return {
            success: false,
            message: `That site is already set up as "${taken.name}".`,
          };
        }
      }

      // Office names are unique by index, but that index cannot see site rows
      // (models/clockLocationModel.js explains why), so a site named onto an
      // office has to be caught here instead.
      if (projectSiteId && (await officeNameTaken(trimmed))) {
        return {
          success: false,
          message: `An office is already called "${trimmed}". Give this one a different name.`,
        };
      }

      const created = await ClockLocationModel.create({
        name: trimmed,
        kind,
        projectSiteId: projectSiteId ? createObjectId(projectSiteId) : null,
      });

      recordAudit({
        entityId: created._id,
        after: created.toObject(),
        description: `Created ${kind} location "${trimmed}"`,
      });

      return {
        success: true,
        message: "Location created",
        data: JSON.stringify(created),
      };
    } catch (error) {
      if (error?.code === 11000) {
        return { success: false, message: "A location with that name exists" };
      }
      console.log("Error creating clock location:", error);
      return { success: false, message: "Could not create the location" };
    }
  },
  { module: "ClockLocation" },
);

export const updateClockLocation = withAudit(
  "ClockLocation.update",
  async ({ id, name, kind, projectSiteId } = {}) => {
    try {
      const auth = await requireSuperAdmin();
      if (!auth.ok) return { success: false, message: auth.message };
      if (!id || !isValidObjectId(id)) {
        return { success: false, message: "Invalid location" };
      }

      await connect();
      const before = await ClockLocationModel.findById(createObjectId(id)).lean();
      if (!before) return { success: false, message: "Location not found" };

      const changes = {};
      if (name !== undefined) {
        const trimmed = (name || "").trim();
        if (!trimmed) return { success: false, message: "Name is required" };
        changes.name = trimmed;
      }
      if (kind !== undefined) {
        if (!["office", "site"].includes(kind)) {
          return { success: false, message: "Invalid location type" };
        }
        changes.kind = kind;
      }
      if (projectSiteId !== undefined) {
        if (projectSiteId && !isValidObjectId(projectSiteId)) {
          return { success: false, message: "Invalid site" };
        }
        changes.projectSiteId = projectSiteId
          ? createObjectId(projectSiteId)
          : null;
      }

      // Same gap as on create: the unique index does not cover site rows, so a
      // site renamed onto an office's name has to be refused here. Checked
      // against the resulting shape, since this call can change both at once.
      const willBeSite =
        changes.projectSiteId !== undefined
          ? Boolean(changes.projectSiteId)
          : Boolean(before.projectSiteId);
      if (
        willBeSite &&
        changes.name &&
        (await officeNameTaken(changes.name, before._id))
      ) {
        return {
          success: false,
          message: `An office is already called "${changes.name}". Give this one a different name.`,
        };
      }

      const after = await ClockLocationModel.findByIdAndUpdate(
        createObjectId(id),
        { $set: changes },
        { new: true },
      ).lean();

      recordAudit({
        entityId: id,
        before,
        after,
        description: `Updated location "${after?.name}"`,
      });

      return { success: true, message: "Location updated" };
    } catch (error) {
      if (error?.code === 11000) {
        return { success: false, message: "A location with that name exists" };
      }
      console.log("Error updating clock location:", error);
      return { success: false, message: "Could not update the location" };
    }
  },
  { module: "ClockLocation" },
);

/**
 * Choose which office is the default.
 *
 * The default is where a clock-in that names no location is recorded: an office
 * scan from before locations existed, and the fallback when a scan arrives with
 * no site. Until now nothing set it — `ensureDefaultLocation()` picked one on
 * first use and that was the end of it, so a company with two offices was stuck
 * with whichever one the migration happened to adopt.
 *
 * Offices only. A site cannot be the fallback for records that have no site;
 * allowing it would file office attendance under a job.
 *
 * Not retroactive, deliberately, and the same rule as tag reassignment (§5 of
 * CLOCK_LOCATION_PLAN.md): records already written keep the location they were
 * written with. Moving them would rewrite where somebody was, which nobody can
 * verify after the fact.
 */
export const setDefaultLocation = withAudit(
  "ClockLocation.setDefault",
  async ({ id } = {}) => {
    try {
      const auth = await requireSuperAdmin();
      if (!auth.ok) return { success: false, message: auth.message };
      if (!id || !isValidObjectId(id)) {
        return { success: false, message: "Invalid location" };
      }

      await connect();
      const target = await ClockLocationModel.findById(
        createObjectId(id),
      ).lean();
      if (!target) return { success: false, message: "Location not found" };

      if (target.projectSiteId) {
        return {
          success: false,
          message:
            "A site cannot be the default. The default is where clock-ins " +
            "that name no site are recorded, so it has to be an office.",
        };
      }
      if (!target.isActive) {
        return {
          success: false,
          message: "An archived location cannot be the default.",
        };
      }
      if (target.isDefault) {
        return { success: true, message: `"${target.name}" is already the default` };
      }

      const previous = await ClockLocationModel.findOne({
        isDefault: true,
      }).lean();

      // Clear first, then set. The partial unique index allows exactly one
      // default per company, so setting before clearing collides with the
      // office that currently holds it.
      if (previous) {
        await ClockLocationModel.updateOne(
          { _id: previous._id },
          { $set: { isDefault: false } },
        );
      }
      await ClockLocationModel.updateOne(
        { _id: target._id },
        { $set: { isDefault: true } },
      );

      recordAudit({
        entityId: target._id,
        before: previous ? { isDefault: previous.name } : undefined,
        after: { isDefault: target.name },
        description: previous
          ? `Default clock-in location moved from "${previous.name}" to "${target.name}"`
          : `Default clock-in location set to "${target.name}"`,
      });

      return {
        success: true,
        message: `"${target.name}" is now the default. Existing records keep the location they were recorded at.`,
      };
    } catch (error) {
      console.log("Error setting default location:", error);
      return { success: false, message: "Could not set the default" };
    }
  },
  { module: "ClockLocation" },
);

/**
 * Archive a location.
 *
 * Never deleted: clock records point at it, and those are a record of where
 * somebody actually was. Archiving takes it off the pickers and leaves the
 * history readable.
 */
export const archiveClockLocation = withAudit(
  "ClockLocation.archive",
  async ({ id } = {}) => {
    try {
      const auth = await requireSuperAdmin();
      if (!auth.ok) return { success: false, message: auth.message };
      if (!id || !isValidObjectId(id)) {
        return { success: false, message: "Invalid location" };
      }

      await connect();
      const location = await ClockLocationModel.findById(
        createObjectId(id),
      ).lean();
      if (!location) return { success: false, message: "Location not found" };

      // The default is where scans with no site land. Archiving it would send
      // them nowhere.
      if (location.isDefault) {
        return {
          success: false,
          message:
            "This is the default location — make another one the default first.",
        };
      }

      await ClockLocationModel.updateOne(
        { _id: createObjectId(id) },
        { $set: { isActive: false } },
      );

      recordAudit({
        entityId: id,
        before: location,
        after: { ...location, isActive: false },
        description: `Archived location "${location.name}"`,
      });

      return { success: true, message: "Location archived" };
    } catch (error) {
      console.log("Error archiving clock location:", error);
      return { success: false, message: "Could not archive the location" };
    }
  },
  { module: "ClockLocation" },
);

/** Sites that do not have a location yet — what the "add" picker offers. */
export async function getSitesWithoutLocation() {
  try {
    await connect();
    const [sites, locations] = await Promise.all([
      ProjectSiteModel.find({ isActive: true }).select("siteName").lean(),
      ClockLocationModel.find({ isActive: true }).select("projectSiteId").lean(),
    ]);

    const taken = new Set(
      locations.filter((l) => l.projectSiteId).map((l) => String(l.projectSiteId)),
    );
    const free = sites.filter((s) => !taken.has(String(s._id)));

    return { success: true, data: JSON.stringify(free) };
  } catch (error) {
    console.log("Error loading sites without a location:", error);
    return { success: false, message: "Could not load sites" };
  }
}
