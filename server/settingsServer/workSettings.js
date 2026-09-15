"use server";

import { connect } from "@/db/db";
import { withAudit, recordAudit } from "@/lib/audit";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import {
  DEFAULT_DAYS_PER_WEEK,
  DEFAULT_FIXED_WEEKLY_HOURS,
} from "@/lib/workHours";
import WorkSettingModel from "@/models/workSettingModel";
import { getServerSideProps } from "../session/session";

/**
 * The company-wide working-time defaults, creating the single settings
 * document on first read so callers never have to handle its absence.
 *
 * Readable by any signed-in admin — the figure drives numbers shown on the
 * attendance screens — but only a super admin can change it.
 */
export async function getWorkSettings() {
  try {
    await connect();
    let settings = await WorkSettingModel.findOne();
    if (!settings) {
      settings = await WorkSettingModel.create({
        fixedWeeklyHours: DEFAULT_FIXED_WEEKLY_HOURS,
        defaultDaysPerWeek: DEFAULT_DAYS_PER_WEEK,
      });
    }
    return { success: true, data: JSON.stringify(settings) };
  } catch (error) {
    console.log("Error fetching work settings:", error);
    return {
      success: false,
      message: "Failed to load working-time settings",
      data: JSON.stringify({
        fixedWeeklyHours: DEFAULT_FIXED_WEEKLY_HOURS,
        defaultDaysPerWeek: DEFAULT_DAYS_PER_WEEK,
      }),
    };
  }
}

/**
 * Change the company-wide defaults. Super admin only: the fixed figure values
 * the paid leave of everyone who is not on custom hours, so it moves numbers
 * across the whole organisation at once.
 */
export const updateWorkSettings = withAudit(
  "WorkSetting.update",
  async function ({ fixedWeeklyHours, defaultDaysPerWeek } = {}) {
    try {
      const { props } = await getServerSideProps();
      const user = props?.session?.user;
      if (user?.role !== "superAdmin") {
        return { success: false, message: "Not authorized" };
      }

      const hours = Number(fixedWeeklyHours);
      const days = Number(defaultDaysPerWeek);
      if (!Number.isFinite(hours) || hours < 1 || hours > 80) {
        return {
          success: false,
          message: "Weekly hours must be between 1 and 80",
        };
      }
      if (!Number.isFinite(days) || days < 1 || days > 7) {
        return {
          success: false,
          message: "Days per week must be between 1 and 7",
        };
      }

      await connect();
      const before = await WorkSettingModel.findOne().lean();
      const after = await WorkSettingModel.findOneAndUpdate(
        {},
        {
          fixedWeeklyHours: hours,
          defaultDaysPerWeek: days,
          updatedBy:
            user?._id && isValidObjectId(user._id)
              ? createObjectId(user._id)
              : undefined,
          updatedByName: user?.name,
        },
        { new: true, upsert: true }
      ).lean();

      recordAudit({
        entityId: after?._id?.toString(),
        before: before
          ? {
              fixedWeeklyHours: before.fixedWeeklyHours,
              defaultDaysPerWeek: before.defaultDaysPerWeek,
            }
          : undefined,
        after: {
          fixedWeeklyHours: after?.fixedWeeklyHours,
          defaultDaysPerWeek: after?.defaultDaysPerWeek,
        },
        description: `Company working time set to ${hours}h/week over ${days} days`,
      });

      return {
        success: true,
        message: "Working-time settings saved",
        data: JSON.stringify(after),
      };
    } catch (error) {
      console.log("Error updating work settings:", error);
      return { success: false, message: "Failed to save settings" };
    }
  },
  { module: "Settings" }
);
