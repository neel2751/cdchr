import { normalizeDateToUTC } from "@/lib/formatDate";
import {
  updateClockManuallyById,
  updateClockManuallyByIdNew,
} from "@/server/timeOffServer/updateClockServer";
import { getUKTime } from "@/utils/time";
import { toast } from "sonner";

export const handleTimeAction = async ({
  clockId,
  type, // 'site' or 'office'
  employeeId,
  siteId,
  actionType = null, // 'clockIn', 'clockOut', etc.
  manualTimes = null, // { clockIn, clockOut, breakIn, breakOut }
}) => {
  const now = getUKTime({ format: "HH:mm" });
  const fullDate = new Date();

  const date = normalizeDateToUTC(new Date());
  const payload = {
    id: clockId,
    type, // required to know which model to update
    date,
    employeeId,
    siteId,
  };
  const actions = [];

  // Set fields dynamically based on manualTimes or actionType
  if (manualTimes) {
    if (manualTimes.clockIn) {
      payload.clockIn = manualTimes.clockIn;
      actions.push({
        action: "clockIn",
        time: fullDate,
        source: "manual",
      });
    }
    if (manualTimes.breakIn) {
      payload.breakIn = manualTimes.breakIn;
      actions.push({
        action: "breakIn",
        time: fullDate,
        source: "manual",
      });
    }
    if (manualTimes.breakOut) {
      payload.breakOut = manualTimes.breakOut;
      actions.push({
        action: "breakOut",
        time: fullDate,
        source: "manual",
      });
    }
    if (manualTimes.clockOut) {
      payload.clockOut = manualTimes.clockOut;
      actions.push({
        action: "clockOut",
        time: fullDate,
        source: "manual",
      });
    }
  } else if (actionType) {
    const time = now;
    switch (actionType) {
      case "clockIn":
        payload.clockIn = time;
        payload.status = "checked-in";
        actions.push({ action: "clockIn", time: fullDate, source: "manual" });
        break;
      case "breakIn":
        payload.breakIn = time;
        payload.status = "break-in";
        actions.push({ action: "breakIn", time: fullDate, source: "manual" });
        break;
      case "breakOut":
        payload.breakOut = time;
        payload.status = "break-out";
        actions.push({ action: "breakOut", time: fullDate, source: "manual" });
        break;
      case "clockOut":
        payload.clockOut = time;
        payload.status = "checked-out";
        actions.push({ action: "clockOut", time: fullDate, source: "manual" });
        break;
      default:
        toast.error("⚠️ Invalid action type");
        return;
    }
  } else {
    toast.error("⚠️ Must provide either manualTimes or actionType");
    return;
  }

  if (actions.length > 0) {
    payload.actions = actions;
  }
  const result = await updateClockManuallyById(payload);
  return result;
};

export const handleTimeActionNew = async ({
  clockId = null,
  employeeId,
  siteId = null,
  actionType = null,
  manualTimes = null,
  employeeType,
  currentBreaks = [], // pass current breaks from UI if needed
  selectedDate = null, // date currently being viewed (defaults to today)
}) => {
  const now = getUKTime({ format: "HH:mm" });
  const fullDate = new Date();
  // Use the date the admin is actually viewing so that fixing a missed
  // clock in/out on a past date writes to that date, not today.
  const date = selectedDate
    ? normalizeDateToUTC(new Date(selectedDate))
    : normalizeDateToUTC(new Date());

  const payload = {
    id: clockId,
    employeeId,
    siteId,
    date,
    actions: [],
    employeeType,
  };

  // Manual times
  if (manualTimes) {
    if (manualTimes.clockIn) {
      payload.clockIn = manualTimes.clockIn;
      payload.actions.push({
        action: "clockIn",
        time: fullDate,
        source: "manual",
      });
    }
    if (manualTimes.clockOut) {
      payload.clockOut = manualTimes.clockOut;
      payload.actions.push({
        action: "clockOut",
        time: fullDate,
        source: "manual",
      });
    }
    if (manualTimes.breaks?.length) {
      payload.breaks = manualTimes.breaks;
      payload.actions.push({
        action: "breaksUpdated",
        time: fullDate,
        source: "manual",
      });
    }
  }

  // Quick actions
  else if (actionType) {
    const updatedBreaks = [...currentBreaks]; // clone existing breaks

    switch (actionType) {
      case "clockIn":
        payload.clockIn = now;
        payload.status = "checked-in";
        break;
      case "breakIn":
        // append a new break object
        updatedBreaks.push({ breakIn: now, breakOut: null });
        payload.breaks = updatedBreaks;
        payload.status = "on-break";
        break;
      case "breakOut":
        // find last open break (has breakIn and no breakOut)
        const lastBreakIndex = updatedBreaks
          .map((b) => Boolean(b?.breakIn) && !b?.breakOut)
          .lastIndexOf(true);

        if (lastBreakIndex >= 0) {
          updatedBreaks[lastBreakIndex].breakOut = now;
        } else {
          toast.error("⚠️ No open break found. Please do Break In first.");
          return;
        }

        payload.breaks = updatedBreaks;
        payload.status = "break-ended";
        break;
      case "clockOut":
        payload.clockOut = now;
        payload.status = "checked-out";
        break;
      default:
        toast.error("⚠️ Invalid action type");
        return;
    }

    payload.actions.push({
      action: actionType,
      time: fullDate,
      source: "manual",
    });
  } else {
    toast.error("⚠️ Must provide either manualTimes or actionType");
    return;
  }

  // console.log("Payload for clock update:", payload);
  // return;

  // Call backend
  const result = await updateClockManuallyByIdNew(payload);

  if (result.success) toast.success(`✅ ${result.message}`);
  else toast.error(`❌ ${result.message}`);

  return result;
};
