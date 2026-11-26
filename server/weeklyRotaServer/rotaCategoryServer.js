"use server";

import { connect } from "@/db/db";
import { isValidObjectId } from "@/lib/mongodb";
import { permissionRefusal } from "@/lib/actionAccess";
import { getTenantTerms } from "@/lib/tenantTerms";
import { currentTenantId } from "@/lib/tenantContext";
import {
  ROTA_KINDS,
  categoryValueFor,
  entryKind,
  isTime,
} from "@/lib/rotaCategories";
import { withAudit } from "@/lib/audit";
import AttendanceCategoryModel from "@/models/attendanceCategoryModel";
import { addStarterCategories } from "./rotaCategoryStore";

/**
 * The company's rota categories and their rules (lib/rotaCategories.js) —
 * "Shift types" on the Weekly Rota screen.
 *
 * Whoever may edit the rota may change them, as before
 * (server/category/category.js gave the same screen the same right).
 */
const OWNS_ROTA = ["/admin/weeklyRota"];

const view = (c) => ({
  _id: String(c._id),
  name: c.attendanceCategoryName,
  value: c.attendanceCategoryValue,
  description: c.attendanceCategoryDescription || "",
  kind: entryKind(c),
  startTime: c.startTime || "",
  endTime: c.endTime || "",
  isActive: c.isActive !== false,
});

/** Every category, in rota order. */
export async function getRotaCategories() {
  const denied = await permissionRefusal(OWNS_ROTA);
  if (denied) return denied;
  try {
    await connect();
    const rows = await AttendanceCategoryModel.find({ isDeleted: false })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    return { success: true, data: JSON.stringify(rows.map(view)) };
  } catch (error) {
    console.log("getRotaCategories error:", error?.message);
    return { success: false, message: "Could not load the shift types" };
  }
}

/** Add a category, or change one's name, rule or hours. Its key never changes. */
export const saveRotaCategory = withAudit(
  "WeeklyRota.category",
  async ({ id, name, kind, startTime, endTime, description } = {}) => {
    const denied = await permissionRefusal(OWNS_ROTA);
    if (denied) return denied;
    try {
      const cleanName = String(name || "").trim().slice(0, 40);
      if (!cleanName) return { success: false, message: "Give it a name" };
      if (!ROTA_KINDS.includes(kind)) return { success: false, message: "Choose what it means" };
      const hours = kind === "off" ? {} : { startTime, endTime };
      if (kind !== "off" && (startTime || endTime)) {
        if (!isTime(startTime) || !isTime(endTime) || startTime >= endTime) {
          return { success: false, message: "The start must be before the end" };
        }
      }
      await connect();
      const fields = {
        attendanceCategoryName: cleanName,
        attendanceCategoryDescription: String(description || "").trim().slice(0, 200),
        kind,
        startTime: hours.startTime || undefined,
        endTime: hours.endTime || undefined,
      };

      if (id) {
        if (!isValidObjectId(id)) return { success: false, message: "Unknown shift type" };
        const res = await AttendanceCategoryModel.updateOne(
          { _id: id, isDeleted: false },
          kind === "off"
            ? { $set: fields, $unset: { startTime: "", endTime: "" } }
            : { $set: fields }
        );
        if (!res.matchedCount) return { success: false, message: "Unknown shift type" };
        return { success: true, message: `${cleanName} saved` };
      }

      const value = categoryValueFor(cleanName);
      if (await AttendanceCategoryModel.exists({ attendanceCategoryValue: value, isDeleted: false })) {
        return { success: false, message: "There is already one with that name" };
      }
      const last = await AttendanceCategoryModel.findOne({ isDeleted: false })
        .sort({ sortOrder: -1 })
        .select("sortOrder")
        .lean();
      await AttendanceCategoryModel.create({
        ...fields,
        attendanceCategoryValue: value,
        sortOrder: (last?.sortOrder ?? 0) + 1,
        isActive: true,
        isDeleted: false,
      });
      return { success: true, message: `${cleanName} added` };
    } catch (error) {
      console.log("saveRotaCategory error:", error?.message);
      return { success: false, message: "Could not save it" };
    }
  },
  { module: "WeeklyRota" }
);

/**
 * Take a category off the rota's choices. Rotas already saved with it keep
 * it — they store its name and rule — so nothing past changes.
 */
export const removeRotaCategory = withAudit(
  "WeeklyRota.categoryRemove",
  async (id) => {
    const denied = await permissionRefusal(OWNS_ROTA);
    if (denied) return denied;
    try {
      if (!isValidObjectId(id)) return { success: false, message: "Unknown shift type" };
      await connect();
      const res = await AttendanceCategoryModel.updateOne(
        { _id: id, isDeleted: false },
        { $set: { isDeleted: true, isActive: false } }
      );
      if (!res.matchedCount) return { success: false, message: "Unknown shift type" };
      return { success: true, message: "Removed" };
    } catch (error) {
      console.log("removeRotaCategory error:", error?.message);
      return { success: false, message: "Could not remove it" };
    }
  },
  { module: "WeeklyRota" }
);

/** Add the starter set, in the company's words, where it is missing. */
export const addStarterRotaCategories = withAudit(
  "WeeklyRota.categoryStarters",
  async () => {
    const denied = await permissionRefusal(OWNS_ROTA);
    if (denied) return denied;
    try {
      await connect();
      const terms = await getTenantTerms(await currentTenantId());
      const added = await addStarterCategories(terms);
      return {
        success: true,
        message: added ? `${added} shift type${added === 1 ? "" : "s"} added` : "You have them all already",
      };
    } catch (error) {
      console.log("addStarterRotaCategories error:", error?.message);
      return { success: false, message: "Could not add them" };
    }
  },
  { module: "WeeklyRota" }
);
