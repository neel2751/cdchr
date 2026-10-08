"use server";
import { connect } from "@/db/db";
import { carriedState } from "@/lib/carryForward";
import LeaveRequestModel from "@/models/leaveRequestModel";
import { getServerSideProps } from "../session/session";
import CommonLeaveModel from "@/models/commonLeaveModel";
import { differenceInDays, weeksToDays } from "date-fns";
import { createObjectId, withTransaction } from "@/lib/mongodb";
import {
  adjustLeaveData,
  hasSufficientLeaveBalance,
  splitHalfDayLeaveIntoAnnualOrUnpaid,
  splitHalfDayLeaveWithYearRules,
  splitLeaveDatesByYear,
  splitLeaveWithYearRules,
  splitLeaveWithYearRulesByDates,
  updateLeaveBalance,
  validateLeaveData,
  validateOverlap,
  validateOverlappingHalfDayLeave,
  validateOverlappingLeave,
} from "./helper/helper";
import { excludeBankHolidays, describeExclusion } from "@/lib/bankHolidays";
import { getWorkSettings } from "../settingsServer/workSettings";
import { getBankHolidays } from "../holidayServer/holidayServer";
import { normalizeDateToUTC } from "@/lib/formatDate";
import { getLeaveYearString } from "@/helper/getLeaveYearString";
import { getLeaveSettings } from "../leaveSettingServer";
import { create } from "lodash";
import {
  hasSickNote,
  needsSickNote,
  SICK_NOTE_REQUIRED_MESSAGE,
} from "@/lib/sickNote";

/**
 * The date a request should be recorded as having been raised.
 *
 * Defaults to today. An admin entering a historical record may pass the real
 * date it was raised so the notice period reads correctly; an employee cannot,
 * since backdating their own request would rewrite how much notice they gave.
 * A future date is ignored — notice cannot be given after the fact.
 */
function resolveSubmitDate(leaveSubmitDate, adminId) {
  const today = normalizeDateToUTC(new Date());
  if (!adminId || !leaveSubmitDate) return today;

  const chosen = normalizeDateToUTC(new Date(leaveSubmitDate));
  if (!chosen || Number.isNaN(chosen.getTime())) return today;

  return chosen > today ? today : chosen;
}

/**
 * Drop the days the company does not charge for, when it closes on bank
 * holidays.
 *
 * Enforced here and not only in the date picker for the same reason the sick
 * note rule is: this is the one engine every submission path funnels through,
 * and a disabled day in a calendar is a courtesy, not a guarantee.
 *
 * Fails open on purpose. If the setting cannot be read, or gov.uk cannot be
 * reached, the days are deducted exactly as they are today — the status quo and
 * a recoverable mistake. Silently refunding somebody a day because a fetch
 * failed is neither.
 *
 * @returns {Promise<{dates: Array, removed: Array, holidays: Array}>}
 */
async function applyBankHolidayRule(leaveDates) {
  try {
    // The setting is read first: when the company does not observe bank
    // holidays there is no reason to call gov.uk at all.
    const settingsRes = await getWorkSettings();
    const settings = settingsRes?.success
      ? JSON.parse(settingsRes.data || "{}")
      : {};
    if (!settings?.observesBankHolidays) {
      return { dates: leaveDates, removed: [], holidays: [] };
    }

    // Fetched for this company's region, not a hardcoded one.
    const holidayRes = await getBankHolidays(settings.bankHolidayRegion);
    const holidays = holidayRes?.success
      ? JSON.parse(holidayRes.data || "[]")
      : [];

    const { kept, removed } = excludeBankHolidays(leaveDates, {
      observes: true,
      holidays,
    });
    return { dates: kept, removed, holidays };
  } catch (error) {
    console.log("Bank holiday rule skipped:", error?.message);
    return { dates: leaveDates, removed: [], holidays: [] };
  }
}

/**
 * Normalises the sick note a form sends us into the shape stored on the leave
 * request, and refuses the request when the note is required but missing.
 *
 * The rule is enforced here rather than in each form so every route in —
 * employee, admin-for-employee and the edit flow — is covered by one check.
 */
function resolveSickNote({ leaveType, leaveDates, sickNote, uploadedBy }) {
  const note = Array.isArray(sickNote) ? sickNote[0] : sickNote;

  if (needsSickNote(leaveType, leaveDates) && !hasSickNote(note)) {
    return { success: false, message: SICK_NOTE_REQUIRED_MESSAGE };
  }

  if (!hasSickNote(note)) return { success: true, sickNote: undefined };

  return {
    success: true,
    sickNote: {
      key: note.key,
      fileName: note.fileName,
      fileSize: note.fileSize,
      fileType: note.fileType,
      access: note.access || "private",
      uploadedAt: new Date(),
      uploadedBy: uploadedBy ? createObjectId(uploadedBy) : undefined,
    },
  };
}

export async function storeEmployeeLeaveData(data, requestId) {
  try {
    await connect();
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;

    if (requestId) {
      // console.log("update leave data");
      // const response = await editLeaveRequest({
      //   data,
      //   requestId,
      //   employeeId,
      // });
      // return response;

      const response = await editLeaveRequestAdvanced({
        requestIds: [requestId],
        employeeId: data.employeeId || employeeId,
        newLeaveDates: data.leaveDates,
        leaveType:
          data.leaveType === "Half Day" ? "Annual Leave" : data.leaveType,
        isHalfDay: data.leaveType === "Half Day",
        halfDayType: data.halfDayType || null,
        leaveReason: data.leaveReason || "",
        sickNote: data.sickNote,
        submitBy: employeeId,
      });
      return response;
    } else {
      if (data?.leaveType === "Half Day") {
        const validatedOverlap = await validateOverlappingHalfDayLeave(
          employeeId,
          leaveDates,
          halfDayType,
          session
        );

        if (!validatedOverlap.success) {
          return validatedOverlap;
        }
        const response = await addHalfDayLeave({
          data: { ...data, totalCount: 0.5 },
          employeeId,
        });
        return response;
      } else {
        const overlapCheck = await validateOverlappingLeave(
          employeeId,
          data.leaveDates
        );

        if (!overlapCheck.success) {
          return overlapCheck;
        }
        const response = await addLeaveRequest({ data, employeeId });
        return response;
      }
    }
  } catch (error) {
    console.log(" Error fetching employee leave data", error);
    return { success: false, message: "Error fetching employee leave data" };
  }
}

// Five superseded functions were removed from this file: addLeaveRequestOld,
// addLeaveRequestNew, addHalfDayLeaveOld, addHalfDayLeaveNew and
// editLeaveRequestOld.
//
// None of them was called from anywhere. That did not make them harmless —
// every one was exported from this "use server" module, so each was a live POST
// endpoint into the leave balance that nobody was maintaining. One still
// carried the fractional-balance defect that silently dropped a requested day
// from the record, months after the supported path had it fixed.
//
// What survives below is the whole supported surface: addLeaveRequest,
// addHalfDayLeave, editLeaveRequest, editLeaveRequestAdvanced and
// editHalfDayLeave. If a name here looks like it is missing a "new" or
// "advanced" variant, it is not — this is the one.
export async function addLeaveRequest({
  data,
  employeeId,
  adminId,
  session, // 🔥 REQUIRED for edit flow
}) {
  await connect();

  const { leaveType, leaveDates, leaveReason } = data;

  // 0️⃣ Sick note gate — checked before anything is deducted or inserted.
  const sickNoteCheck = resolveSickNote({
    leaveType,
    leaveDates,
    sickNote: data.sickNote,
    uploadedBy: adminId || employeeId,
  });
  if (!sickNoteCheck.success) return sickNoteCheck;

  // 0️⃣b Bank holidays. Deliberately after the sick note gate, which reads the
  // dates as submitted: a sick absence spanning a bank holiday is still an
  // absence of that many consecutive days, whether or not the office was open.
  const bankHolidays = await applyBankHolidayRule(leaveDates);
  const chargeableDates = bankHolidays.dates;

  if (!chargeableDates.length) {
    return {
      success: false,
      message: bankHolidays.removed.length
        ? "Every day you selected is a bank holiday, so there is nothing to book — the office is already closed."
        : "Select at least one date.",
    };
  }

  // When an admin records leave that was taken months ago, stamping it with
  // today's date reads as a request raised after the leave had already started
  // — which is what drove the notice period negative. Only an admin may set it,
  // and never into the future; an employee's own request is always "now".
  const submittedOn = resolveSubmitDate(data.leaveSubmitDate, adminId);

  const settings = await getLeaveSettings();
  // `.data`, not the wrapper: getLeaveSettings returns `{ success, data }`, so
  // `settings.leaveYearStartMonth` was always undefined and this silently fell
  // back to April. A company on any other leave year therefore deducted every
  // booking from the wrong year's balance — the entitlement was filed under the
  // company's real leave year and the deduction looked for an April one.
  const startMonth = settings?.data?.leaveYearStartMonth || 4;

  // 1️⃣ Overlap Validation (inside same transaction)

  // 2️⃣ Split dates by leave year.
  // Built from the chargeable dates, not the submitted ones: excluding once,
  // here, is what keeps the deduction plan, the stored request and the day
  // count from disagreeing with each other.
  const groupedByYear = splitLeaveDatesByYear(chargeableDates, startMonth);

  const finalDeductions = [];

  // 3️⃣ VALIDATE + PLAN DEDUCTIONS (NO UPDATE YET)
  for (const [leaveYear, dates] of Object.entries(groupedByYear)) {
    let remainingDaysToDeduct = dates.length;

    const commonLeave = await CommonLeaveModel.findOne({
      employeeId,
      leaveYear,
    }).session(session);

    if (!commonLeave) {
      return {
        success: false,
        message: `Leave year ${leaveYear} is not generated yet. Contact HR.`,
      };
    }

    const leaveDataList = commonLeave.leaveData;

    const annual = leaveDataList.find((l) => l.leaveType === leaveType);

    if (!annual) {
      return {
        success: false,
        message: `${leaveType} not configured for ${leaveYear}`,
      };
    }
    // Removed from this employee by an admin. Checked here as well as filtered
    // out of the dropdown, because this action is an addressable endpoint and the
    // dropdown is only what the screen offers.
    if (annual.isDelete === true) {
      return {
        success: false,
        message: `${leaveType} has been removed from this employee for ${leaveYear}`,
      };
    }
    // How far through this year's dates the allocation has got. Tracked
    // explicitly so each date is handed to exactly one bucket — the paid rows
    // take from the front, and whatever is left over follows on from there.
    let cursor = 0;

    // 🟡 Deduct from paid leave first.
    //
    // Whole days only. Every date in this request is a full day, so a
    // fractional balance cannot buy one: 2.5 days remaining pays for two, and
    // the half stays on the balance where a later half-day request can still
    // spend it.
    //
    // Flooring is what stops a date going missing. `days` used to be allowed to
    // come out fractional and the dates were sliced by it — `slice(0, 2.5)`
    // returns two entries and `slice(-1.5)` one, so with four days requested
    // the third was charged for and then written to no leave record at all. It
    // appeared on no rota, blocked no clash and showed on no report.
    //
    // Carried-over days that have passed their expiry are NOT payable, however
    // much `remaining` says. `expireAfterMonths` was a setting the form demanded
    // and nothing read, so "carried days expire after three months" meant they
    // lasted the whole year and were spent months after they should have gone.
    // Enforced here as well as materialised by the nightly job, because a day
    // must be unbookable from the instant it expires rather than from whenever
    // the job next runs.
    const carried = carriedState(annual);
    const payableDays = Math.floor(carried.usable);

    if (payableDays > 0) {
      const useAnnual = Math.min(payableDays, remainingDaysToDeduct);

      finalDeductions.push({
        commonLeaveId: commonLeave._id,
        leaveYear,
        leaveType: leaveType,
        days: useAnnual,
        dates: dates.slice(cursor, cursor + useAnnual),
      });

      cursor += useAnnual;
      remainingDaysToDeduct -= useAnnual;
    }

    // 🔴 Remaining → Unpaid (unlimited)
    if (remainingDaysToDeduct > 0) {
      finalDeductions.push({
        commonLeaveId: commonLeave._id,
        leaveYear,
        leaveType: "Unpaid Leave",
        days: remainingDaysToDeduct,
        // Everything the paid row did not take, by position rather than by
        // count, so the two cannot overlap or leave a gap between them.
        dates: dates.slice(cursor),
      });

      cursor = dates.length;
      remainingDaysToDeduct = 0;
    }
  }

  // 4️⃣ APPLY ALL DEDUCTIONS (ATOMIC, SAME SESSION)
  for (const item of finalDeductions) {
    await CommonLeaveModel.updateOne(
      {
        _id: item.commonLeaveId,
        "leaveData.leaveType": item.leaveType,
      },
      {
        $inc: {
          "leaveData.$.used": item.days,
          ...(item.leaveType !== "Unpaid Leave"
            ? { "leaveData.$.remaining": -item.days }
            : {}),
        },
        $push: {
          leaveHistory: {
            leaveType: item.leaveType,
            leaveYear: item.leaveYear,
            leaveDays: item.days,
            leaveDates: item.dates,
            createdAt: new Date(),
          },
        },
      },
      { session }
    );
  }

  // 5️⃣ BUILD REQUEST DOCUMENTS (ONE PER TYPE/YEAR/BLOCK)
  const requestsToInsert = [];

  for (const item of finalDeductions) {
    const { leaveYear, leaveType, days: leaveDays, dates: leaveDates } = item;

    const sortedDates = [...leaveDates].sort(
      (a, b) => new Date(a) - new Date(b)
    );

    const leaveStartDate = sortedDates[0];
    const leaveEndDate = sortedDates[sortedDates.length - 1];

    // A backdated record was also decided back then, so the approval carries
    // the same date rather than today's.
    const approved = adminId
      ? { approvedBy: adminId, approvedDate: submittedOn }
      : {};

    requestsToInsert.push({
      employeeId: createObjectId(employeeId),
      leaveYear,
      leaveType,
      leaveDates,
      leaveDays,
      leaveStartDate,
      leaveEndDate,
      leaveReason,
      leaveSubmitDate: submittedOn,
      leaveStatus: adminId ? "Approved" : "Pending",
      isPaid: leaveType !== "Unpaid Leave",
      leaveBreakdown: [{ leaveType, leaveYear, leaveDays }],
      // A submission can split across leave years and into unpaid days; the
      // same note belongs to every piece of it.
      ...(sickNoteCheck.sickNote
        ? { sickNote: sickNoteCheck.sickNote }
        : {}),
      ...approved,
      addByAdmin: !!adminId,
    });
  }

  // 6️⃣ INSERT ALL REQUESTS
  await LeaveRequestModel.insertMany(requestsToInsert, { session });

  // Naming the days that were free is the difference between the booking
  // looking wrong and looking right: "3 days booked" after selecting five reads
  // like a bug until you say which two were bank holidays.
  const exclusionNote = describeExclusion(
    bankHolidays.removed,
    bankHolidays.holidays
  );

  return {
    success: true,
    message: exclusionNote
      ? `Leave added successfully. ${exclusionNote}`
      : "Leave added successfully.",
  };
}

export async function addHalfDayLeave({
  data,
  employeeId,
  adminId,
  session, // 🔥 REQUIRED (from edit or normal flow)
}) {
  await connect();

  const { leaveType, leaveDates, halfDayType, leaveReason } = data;

  // Same rule as a full-day request: an admin may record when a historical
  // half day was actually raised, an employee may not.
  const submittedOn = resolveSubmitDate(data.leaveSubmitDate, adminId);

  const settings = await getLeaveSettings();
  // `.data`, not the wrapper: getLeaveSettings returns `{ success, data }`, so
  // `settings.leaveYearStartMonth` was always undefined and this silently fell
  // back to April. A company on any other leave year therefore deducted every
  // booking from the wrong year's balance — the entitlement was filed under the
  // company's real leave year and the deduction looked for an April one.
  const startMonth = settings?.data?.leaveYearStartMonth || 4;

  // 1️⃣ Overlap validation (inside transaction)

  // 2️⃣ Split by leave year
  const splitByYear = splitLeaveDatesByYear(leaveDates, startMonth);

  const finalDeductions = [];

  // 3️⃣ PLAN DEDUCTIONS (NO UPDATE YET 🔥)
  for (const [leaveYear, yearDates] of Object.entries(splitByYear)) {
    const commonLeave = await CommonLeaveModel.findOne({
      employeeId,
      leaveYear,
    }).session(session);

    if (!commonLeave) {
      return {
        success: false,
        message: `Leave entitlement not generated for ${leaveYear}`,
      };
    }

    const annual = commonLeave.leaveData.find(
      (l) => l.leaveType === "Annual Leave"
    );

    const unpaid = commonLeave.leaveData.find(
      (l) => l.leaveType === "Unpaid Leave"
    );

    if (!annual || !unpaid) {
      return {
        success: false,
        message: "Leave categories not configured",
      };
    }

    // Expired carry-over is not spendable here either — see the note on the
    // full-day path. Taken once before the loop: the lapse is a property of the
    // row as it stood when the request arrived, not something that changes as
    // this request spends against it.
    const halfDayLapsed = carriedState(annual).lapsed;
    let spendable = Math.max(Number(annual.remaining || 0) - halfDayLapsed, 0);

    // 🔥 EACH DATE IS INDEPENDENT ENTRY
    for (const date of yearDates) {
      let deducted = false;

      // 🟡 Annual first
      if (spendable >= 0.5) {
        finalDeductions.push({
          commonLeaveId: commonLeave._id,
          leaveYear,
          leaveType: leaveType,
          days: 0.5,
          date,
          isPaid: true,
        });

        annual.remaining -= 0.5;
        annual.used += 0.5;
        spendable -= 0.5;

        deducted = true;
      }

      // The "🟠 Carry Forward" branch that used to sit here was dead twice over.
      // It tested `annual.carryForwardAllowed` and `annual.carryForwardRemaining`
      // — two fields nothing in the codebase has ever written — and guarded them
      // with `settings?.carryForwardEnabled`, read off the `{ success, data }`
      // wrapper and therefore always undefined. It could not run.
      //
      // It was also the wrong model: carried days are not a second balance to
      // fall back on, they are part of `remaining` and are spent first. See
      // carriedState() in lib/carryForward.js.

      // 🔴 Fallback → Unpaid (UNLIMITED)
      if (!deducted) {
        finalDeductions.push({
          commonLeaveId: commonLeave._id,
          leaveYear,
          leaveType: "Unpaid Leave",
          days: 0.5,
          date,
          isPaid: false,
        });

        unpaid.used += 0.5;
      }
    }

    commonLeave.markModified("leaveData");
    await commonLeave.save({ session });
  }

  console.log(finalDeductions);

  // 4️⃣ BUILD REQUEST DOCS (ONE PER DATE 🔥)
  const requestsToInsert = [];

  for (const item of finalDeductions) {
    const approved = adminId
      ? { approvedBy: adminId, approvedDate: submittedOn }
      : {};

    requestsToInsert.push({
      employeeId: createObjectId(employeeId),
      leaveYear: item.leaveYear,
      leaveType: item.leaveType,
      leaveSubmitDate: submittedOn,
      leaveStatus: adminId ? "Approved" : "Pending",
      leaveReason,
      leaveDates: [item.date], // 🔥 SINGLE DATE
      leaveStartDate: item.date,
      leaveEndDate: item.date,
      leaveDays: 0.5,
      isPaid: item.isPaid,
      isHalfDay: true,
      halfDayType,
      submitBy: adminId || employeeId,
      leaveBreakdown: [
        {
          leaveType: item.leaveType,
          leaveYear: item.leaveYear,
          leaveDays: 0.5,
        },
      ],
      ...approved,
      addByAdmin: !!adminId,
    });
  }

  // 5️⃣ INSERT ALL
  await LeaveRequestModel.insertMany(requestsToInsert, { session });

  return { success: true, message: "Half-day leave added successfully." };
}

export async function editLeaveRequestAdvanced({
  requestIds, // array of old LeaveRequest IDs
  employeeId,
  newLeaveDates,
  leaveType,
  isHalfDay,
  halfDayType,
  leaveReason,
  sickNote,
  submitBy,
}) {
  return await withTransaction(async (session) => {
    const mongooseId = createObjectId(employeeId);

    // 1️⃣ Fetch old leaves
    const oldLeaves = await LeaveRequestModel.find({
      _id: { $in: requestIds },
      leaveStatus: { $in: ["Pending", "Approved"] },
      isDeleted: false,
    }).session(session);

    if (!oldLeaves.length) {
      throw new Error("No valid leave requests found to edit");
    }

    // A record an admin entered for a past absence keeps the date it was
    // originally raised — re-saving it should not turn a historical entry into
    // one submitted today. An employee editing their own request gets a fresh
    // submit date, since the notice they are giving really is from today.
    const carriedSubmitDate = oldLeaves.find((leave) => leave.addByAdmin)
      ?.leaveSubmitDate;

    // An edit that does not re-upload keeps the note already on file, so
    // changing a date on a long sick leave does not ask for it again.
    const carriedSickNote =
      sickNote ||
      oldLeaves.find((leave) => leave.sickNote?.key)?.sickNote?.toObject?.() ||
      oldLeaves.find((leave) => leave.sickNote?.key)?.sickNote;

    // 4️⃣ Overlap validation for new dates
    const overlap = await LeaveRequestModel.find({
      employeeId: mongooseId,
      leaveDates: { $in: newLeaveDates },
      leaveStatus: { $in: ["Pending", "Approved"] },
      isDeleted: false,
      _id: { $nin: requestIds }, // exclude old requests
    }).session(session);

    if (overlap.length > 0) {
      throw new Error("Some selected dates already have leave");
    }

    // 2️⃣ Rollback old leave balances
    for (const old of oldLeaves) {
      const commonLeave = await CommonLeaveModel.findOne({
        employeeId: old.employeeId,
        leaveYear: old.leaveYear,
      });

      const leaveItem = commonLeave.leaveData.find((l) => {
        if (old.leaveType === "Half Day") {
          return (
            l.leaveType === "Annual Leave" || l.leaveType === "Unpaid Leave"
          );
        } else {
          return l.leaveType === old.leaveType;
        }
      });

      if (leaveItem) {
        leaveItem.used -= old.leaveDays;
        if (old.leaveType !== "Unpaid Leave") {
          leaveItem.remaining += old.leaveDays;
        }
      }
      commonLeave.markModified("leaveData");
      await commonLeave.save({ session });
    }

    // 3️⃣ Cancel old leave requests (keep history)
    await LeaveRequestModel.updateMany(
      { _id: { $in: requestIds } },
      {
        $set: {
          leaveStatus: "Cancelled",
          wasExpired: true,
        },
      },
      { session }
    );

    // 5️⃣ Apply new leave using SAME ENGINE
    let result;

    if (isHalfDay) {
      result = await addHalfDayLeave({
        data: {
          leaveDates: newLeaveDates,
          leaveType,
          halfDayType,
          leaveReason,
        },
        employeeId,
        adminId: submitBy !== employeeId ? submitBy : null,
        session,
      });
    } else {
      result = await addLeaveRequest({
        data: {
          leaveDates: newLeaveDates,
          leaveType,
          leaveReason,
          sickNote: carriedSickNote,
          leaveSubmitDate: carriedSubmitDate,
        },
        employeeId,
        adminId: submitBy !== employeeId ? submitBy : null,
        session,
      });
    }

    if (!result.success) {
      return result;
    }

    return {
      success: true,
      message: "Leave edited successfully",
    };
  });
}


// ---------------------- Half-Day Edit ----------------------
export async function editHalfDayLeave({ data, requestId, adminId }) {
  return await withTransaction(async (session) => {
    await connect();
    const { leaveDates, leaveReason } = data;

    if (!leaveDates || leaveDates.length === 0) {
      throw new Error("No leave dates provided");
    }

    const originalRequest = await LeaveRequestModel.findById(requestId).session(
      session
    );
    if (!originalRequest) throw new Error("Leave request not found");

    const employeeId = originalRequest.employeeId;

    // Restrict editing if approved or rejected (for employees)
    if (
      !adminId &&
      ["Approved", "Rejected"].includes(originalRequest.leaveStatus)
    ) {
      throw new Error("Cannot edit approved or rejected request");
    }

    const leaveYear = getLeaveYearString(new Date());

    // Sets for easier comparison
    const existingDatesSet = new Set(
      originalRequest.leaveDates.map((d) => new Date(d).toISOString())
    );
    const newDatesSet = new Set(
      leaveDates.map((d) => new Date(d).toISOString())
    );

    // 1️⃣ Find unchanged dates (no action needed)
    const unchangedDates = leaveDates.filter((d) =>
      existingDatesSet.has(new Date(d).toISOString())
    );

    // 2️⃣ Find newly added dates → add new requests & deduct balance
    const datesToAdd = leaveDates.filter(
      (d) => !existingDatesSet.has(new Date(d).toISOString())
    );

    // 3️⃣ Find removed dates → delete requests & rollback balance
    const datesToRemove = originalRequest.leaveDates.filter(
      (d) => !newDatesSet.has(new Date(d).toISOString())
    );

    // 🔄 Handle newly added dates
    for (const date of datesToAdd) {
      await validateOverlap(
        [
          {
            employeeId,
            leaveDates: [date], // must be array
            leaveYear,
          },
        ],
        requestId // exclude the current one so self-overlap isn’t triggered
      );
      const entry = {
        employeeId,
        leaveDate: date,
        leaveDates: [date],
        leaveStartDate: date,
        leaveEndDate: date,
        leaveDays: 0.5,
        leaveYear,
        leaveReason,
        leaveStatus: adminId ? "Approved" : "Pending",
        addByAdmin: !!adminId,
        createdAt: new Date(),
        isHalfDay: true,
        parentRequestId: requestId,
      };

      // Always deduct Half Day entitlement
      await updateLeaveBalance({
        employeeId,
        leaveYear,
        leaveType: "Half Day",
        leaveDays: 0.5,
        session,
        allowNegative: true,
      });

      // Deduct from Annual Leave if possible, fallback to Unpaid
      let finalLeaveType = originalRequest.leaveType;
      if (finalLeaveType === "Annual Leave") {
        const success = await updateLeaveBalance({
          employeeId,
          leaveYear,
          leaveType: "Annual Leave",
          leaveDays: 0.5,
          session,
        });

        if (!success) {
          finalLeaveType = "Unpaid Leave";
          await updateLeaveBalance({
            employeeId,
            leaveYear,
            leaveType: "Unpaid Leave",
            leaveDays: 0.5,
            session,
            allowNegative: true,
          });
        }
      } else if (finalLeaveType === "Unpaid Leave") {
        await updateLeaveBalance({
          employeeId,
          leaveYear,
          leaveType: "Unpaid Leave",
          leaveDays: 0.5,
          session,
          allowNegative: true,
        });
      }

      entry.leaveType = finalLeaveType;
      await LeaveRequestModel.create([entry], { session });
    }

    // 🔄 Handle removed dates
    if (datesToRemove.length > 0) {
      await LeaveRequestModel.deleteMany({
        employeeId,
        leaveDate: { $in: datesToRemove },
        isHalfDay: true,
        parentRequestId: requestId,
      }).session(session);

      // rollback balances
      for (const d of datesToRemove) {
        const removed = await LeaveRequestModel.findOne({
          employeeId,
          leaveDate: d,
          isHalfDay: true,
          parentRequestId: requestId,
        }).session(session);

        if (removed) {
          await updateLeaveBalance({
            employeeId,
            leaveYear,
            leaveType: removed.leaveType,
            leaveDays: -0.5,
            session,
            allowNegative: true,
          });
          await updateLeaveBalance({
            employeeId,
            leaveYear,
            leaveType: "Half Day",
            leaveDays: -0.5,
            session,
            allowNegative: true,
          });
        }
      }
    }

    // 🔄 Update main request (just keep reason + status fresh)
    // Step 5️⃣ Update main request with first date (if exists)
    const mainEntryDate = leaveDates[0]; // pick the first selected date
    originalRequest.leaveDate = mainEntryDate;
    originalRequest.leaveReason = leaveReason;
    originalRequest.leaveType = originalRequest.leaveType; // keep same
    originalRequest.leaveDays = 0.5;
    originalRequest.leaveYear = leaveYear;
    originalRequest.leaveStatus = adminId ? "Approved" : "Pending";
    originalRequest.adminId = adminId || null;

    // ✅ Fix: for half-day, start and end date are the SAME
    originalRequest.leaveStartDate = mainEntryDate;
    originalRequest.leaveEndDate = mainEntryDate;

    await originalRequest.save({ session });

    return { success: true, message: "Half-day leave updated successfully." };
  });
}

// ---------------------- Main Edit ----------------------
export async function editLeaveRequest({ data, requestId, adminId }) {
  return await withTransaction(async (session) => {
    await connect();

    const originalRequest = await LeaveRequestModel.findById(requestId).session(
      session
    );
    if (!originalRequest) throw new Error("Leave request not found");

    const employeeId = originalRequest?.employeeId;

    // 1️⃣ If this is a half-day request, call half-day edit
    if (originalRequest.isHalfDay) {
      return await editHalfDayLeave({
        data,
        requestId,
        employeeId,
        adminId,
        session,
      });
    }

    // ---------------- Full-Day Leave Logic ----------------
    const { leaveDates, leaveReason } = data;
    if (!leaveDates || leaveDates.length === 0)
      throw new Error("No leave dates provided");

    if (
      !adminId &&
      ["Approved", "Rejected"].includes(originalRequest.leaveStatus)
    )
      throw new Error("Cannot edit approved or rejected request");

    const leaveType = originalRequest.leaveType; // Fixed for full-day
    const leaveYear = getLeaveYearString(new Date());

    // 2️⃣ Restore old balance based on leaveDates
    if (originalRequest.leaveDates && originalRequest.leaveDates.length > 0) {
      const oldLeaveDays = originalRequest.leaveDates.length;
      await updateLeaveBalance({
        employeeId,
        leaveYear: originalRequest.leaveYear,
        leaveType: originalRequest.leaveType,
        leaveDays: -oldLeaveDays,
        session,
        allowNegative: true,
      });
    }

    // 3️⃣ Get current leave data
    const { commonLeave, leaveData } = await validateLeaveData({
      employeeId,
      leaveYear,
      leaveType,
      session,
      adminId,
    });

    // 4️⃣ Split new leave into segments (Annual + fallback Unpaid)
    const entries = await splitLeaveWithYearRulesByDates(
      leaveDates,
      leaveData?.type === "weeks"
        ? weeksToDays(leaveData?.remaining)
        : leaveData.remaining,
      employeeId,
      leaveType,
      adminId ? "Approved" : "Pending",
      adminId
    );
    // 5️⃣ Validate overlaps
    await validateOverlap(entries, requestId);
    // 6️⃣ Apply new allocation
    for (const entry of entries) {
      await updateLeaveBalance({
        employeeId,
        leaveYear: entry.leaveYear,
        leaveType: entry.leaveType,
        leaveDays: entry.leaveDays,
        session,
        allowNegative: entry.leaveType !== "Annual Leave",
      });
    }

    const sortedDates = [...leaveDates].sort(
      (a, b) => new Date(a) - new Date(b)
    );
    // Ensure Correct Order of Leave Dates

    // 7️⃣ Update main request
    const mainEntry = entries[0];
    originalRequest.leaveStartDate = sortedDates[0];
    originalRequest.leaveEndDate = sortedDates[sortedDates.length - 1];
    originalRequest.leaveReason = leaveReason;
    originalRequest.leaveDates = sortedDates;
    originalRequest.leaveDays = entries.reduce(
      (sum, e) => sum + e.leaveDays,
      0
    );
    originalRequest.leaveBreakdown = entries.map((e) => ({
      leaveType: e.leaveType,
      leaveYear: e.leaveYear,
      leaveDays: e.leaveDays,
    }));
    originalRequest.leaveStatus = adminId ? "Approved" : "Pending";
    originalRequest.adminId = adminId || null;

    await originalRequest.save({ session });

    // 8️⃣ Insert additional segments if more than one
    const additionalEntries = entries.slice(1).map((entry) => ({
      ...entry,
      employeeId: createObjectId(employeeId),
      leaveStatus: adminId ? "Approved" : "Pending",
      leaveReason,
      addByAdmin: !!adminId,
      createdAt: new Date(),
    }));

    if (additionalEntries.length > 0) {
      await LeaveRequestModel.insertMany(additionalEntries, { session });
    }

    return { success: true, message: "Leave request updated successfully." };
  });
}
