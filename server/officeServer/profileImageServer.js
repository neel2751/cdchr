"use server";

import { connect } from "@/db/db";
import { recordAudit, withAudit } from "@/lib/audit";
import { resolveEmployeeTarget } from "@/lib/employeeAccess";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import {
  ALLOWED_AVATAR_TYPES,
  MAX_AVATAR_BYTES,
  storeEmployeeAvatar,
} from "../aws/avatar";
import { addMedia, archiveMedia } from "../aws/media";
import { deleteFileFromS3 } from "../aws/upload";

/**
 * An employee's own photo.
 *
 * Whose photo is never a parameter: it is the session's own record, here and in
 * every branch. There is no "upload a photo for this employee" — HR setting
 * somebody's picture for them is not a thing this needed, and leaving the id
 * out means there is nothing to get wrong.
 */

/**
 * Let go of the photo being replaced.
 *
 * Three things, in an order that matters: archive the Media row so it leaves
 * the live library, delete the object so the bytes stop being paid for, and let
 * the storage figure drop by what was freed (deleteFileFromS3 does that last
 * part itself, from the object's real size).
 *
 * Failures are logged, not thrown. A tidy-up that goes wrong must not lose the
 * employee the photo they just uploaded — the worst case is one orphaned object
 * counted against the allowance until the next measurement.
 */
async function discardPrevious(previous) {
  if (!previous?.key) return;
  try {
    if (previous.mediaId) await archiveMedia(previous.mediaId);
    await deleteFileFromS3(previous.key);
  } catch (error) {
    console.log("Could not clear the previous avatar:", error?.message);
  }
}

export const uploadMyProfileImage = withAudit(
  "OfficeEmployee.setProfileImage",
  async (formData) => {
    const file = formData?.get?.("file");
    if (!file || typeof file.arrayBuffer !== "function") {
      return { success: false, message: "No image received" };
    }
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      return { success: false, message: "Use a PNG, JPEG or WebP image" };
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return { success: false, message: "Keep the photo under 2 MB" };
    }

    try {
      const { user } = await resolveEmployeeTarget();
      if (!user?._id) return { success: false, message: "Not signed in" };
      if (!user?.tenantId) {
        return { success: false, message: "No company in context" };
      }

      await connect();
      const employee = await OfficeEmployeeModel.findById(user._id);
      if (!employee) return { success: false, message: "Record not found" };

      const stored = await storeEmployeeAvatar(user.tenantId, file);
      if (!stored.success) return stored;

      // Recorded in Media so the photo appears in Media Management alongside
      // every other file the company stores, and so the storage total has a row
      // to account for. `category: "avatar"` is what makes them separable there.
      const media = await addMedia({
        fileName: file.name || "avatar",
        fileType: file.type,
        fileSize: stored.size,
        url: stored.url,
        key: stored.key,
        access: "private",
        category: "avatar",
        metadata: { employeeId: String(employee._id) },
      });

      // Read field by field rather than spreading the path: `profileImage` is
      // a nested object, not a subdocument, so it has no toObject() and a
      // spread of one would quietly produce {} and strand the old object.
      const previous = employee.profileImage?.key
        ? {
            key: employee.profileImage.key,
            mediaId: employee.profileImage.mediaId,
          }
        : null;

      employee.profileImage = {
        key: stored.key,
        mediaId: media?.mediaId || undefined,
      };
      await employee.save();

      // After the save, not before: if the write fails the employee still has
      // the photo they had a moment ago, rather than a record pointing at an
      // object that has been deleted.
      await discardPrevious(previous);

      recordAudit({
        entityId: String(employee._id),
        description: "Set their own profile photo",
      });

      return { success: true, message: "Photo updated" };
    } catch (error) {
      console.log("Error setting profile image:", error?.message);
      return { success: false, message: "Could not save the photo" };
    }
  },
  { module: "OfficeEmployee" }
);

export const removeMyProfileImage = withAudit(
  "OfficeEmployee.removeProfileImage",
  async () => {
    try {
      const { user } = await resolveEmployeeTarget();
      if (!user?._id) return { success: false, message: "Not signed in" };

      await connect();
      const employee = await OfficeEmployeeModel.findById(user._id);
      if (!employee) return { success: false, message: "Record not found" };
      if (!employee.profileImage?.key) {
        return { success: false, message: "There is no photo to remove" };
      }

      const previous = {
        key: employee.profileImage.key,
        mediaId: employee.profileImage.mediaId,
      };
      // set(path, undefined) is what marks a nested path for $unset; assigning
      // undefined to it directly leaves the old values in place.
      employee.set("profileImage", undefined);
      await employee.save();
      await discardPrevious(previous);

      recordAudit({
        entityId: String(employee._id),
        description: "Removed their own profile photo",
      });

      return { success: true, message: "Photo removed" };
    } catch (error) {
      console.log("Error removing profile image:", error?.message);
      return { success: false, message: "Could not remove the photo" };
    }
  },
  { module: "OfficeEmployee" }
);

/**
 * The signed-in person's own photo, for chrome that has no employee record to
 * hand — the sidebar footer, which knows a session and nothing else.
 */
export async function getMyProfileImage() {
  try {
    const { user } = await resolveEmployeeTarget();
    if (!user?._id) return { success: true, data: JSON.stringify({ key: null }) };

    await connect();
    const employee = await OfficeEmployeeModel.findById(user._id)
      .select("profileImage name")
      .lean();

    return {
      success: true,
      data: JSON.stringify({
        key: employee?.profileImage?.key || null,
        name: employee?.name || "",
      }),
    };
  } catch (error) {
    console.log("Error reading profile image:", error?.message);
    return { success: true, data: JSON.stringify({ key: null }) };
  }
}
