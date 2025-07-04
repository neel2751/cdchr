import { normalizeDateToUTC } from "@/lib/formatDate";
import { updateClockManuallyById } from "@/server/timeOffServer/updateClockServer";
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
  const fullDate = getUKTime({ format: "full" });

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
