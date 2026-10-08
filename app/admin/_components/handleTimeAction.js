import {
  getClockTime,
  getWorkingDate,
  toWorkingDate,
} from "@/lib/clockTime";
import { updateClockManuallyByIdNew } from "@/server/timeOffServer/updateClockServer";
import { toast } from "sonner";

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
  const now = getClockTime();
  const fullDate = new Date();
  // Use the date the admin is actually viewing so that fixing a missed
  // clock in/out on a past date writes to that date, not today.
  const date = toWorkingDate(selectedDate) || getWorkingDate();

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
        break;
      case "breakIn":
        // append a new break object
        updatedBreaks.push({ breakIn: now, breakOut: null });
        payload.breaks = updatedBreaks;
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
        break;
      case "clockOut":
        payload.clockOut = now;
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
