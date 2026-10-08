import { Button } from "@/components/ui/button";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { format } from "date-fns";
import {
  ArrowDownIcon,
  CalendarDays,
  Eye,
  EyeOff,
  PencilLine,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import React from "react";

/**
 * Everything that has happened to one employee's entitlements.
 *
 * `leaveHistory` is a single array that four different writers push to, and this
 * panel used to render all of them as if they were the one kind it knew about:
 *
 *   a total changed      editCommonLeave        oldTotal → newTotal
 *   leave was booked     storeEmployeeLeaveData leaveDays + leaveDates
 *   visibility toggled   handleCommonLeaveStatus isHide
 *   type removed/back    entitlementServer       action
 *
 * So every booking appeared as "Change Annual Leave for undefined to undefined
 * days", with today's date on it — the timestamp was read from `updateAt`, which
 * a booking entry does not have (it writes `createdAt`). Each kind now says what
 * it actually was.
 *
 * And the reason is shown, which is the whole point of having made it mandatory:
 * a required field nobody can read is just friction.
 */

/** Work out which of the four writers produced an entry. */
function kindOf(entry) {
  if (entry?.newTotal !== undefined) return "total";
  if (entry?.leaveDays !== undefined || entry?.leaveDates !== undefined) {
    return "booking";
  }
  if (entry?.action === "removed" || entry?.action === "restored") {
    return "lifecycle";
  }
  if (typeof entry?.isHide === "boolean") return "visibility";
  return "unknown";
}

const ICONS = {
  total: PencilLine,
  booking: CalendarDays,
  lifecycle: Trash2,
  visibility: EyeOff,
  unknown: PencilLine,
};

const Leavehistory = ({ leaveHistory }) => {
  const { scrollRef, isAtBottom, scrollToBottom } = useAutoScroll({
    offset: 20,
    smooth: true,
    content: leaveHistory,
  });

  if (!leaveHistory?.length) {
    return (
      <p className="mt-5 text-center text-sm text-muted-foreground">
        Nothing has changed on these entitlements yet.
      </p>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="max-w-4xl h-full mx-auto w-full mt-5 overflow-y-auto  pb-20"
    >
      {leaveHistory.map((his, index) => {
        const kind = kindOf(his);
        // A booking stamps `createdAt`; everything else stamps `updateAt`.
        // Reading only the latter put today's date on every booking.
        const when = his?.updateAt || his?.createdAt || null;
        const Icon =
          kind === "visibility" && his?.isHide === false
            ? Eye
            : kind === "lifecycle" && his?.action === "restored"
              ? RotateCcw
              : ICONS[kind];

        return (
          <div key={index}>
            <div className="flex gap-x-3">
              <div className="relative after:bg-gray-200 after:-translate-x-0.5 after:w-px after:top-7 after:start-3.5 after:bottom-0 after:absolute">
                <div className="flex justify-center items-center size-7 z-10 relative">
                  <Icon className="text-neutral-500 size-3.5 shrink-0" />
                </div>
              </div>

              <div className="pt-1 pb-4 grow">
                <p className="text-neutral-500 text-sm mb-1">
                  <span className="font-medium text-neutral-800">
                    {his?.updatedByName || "System"}
                  </span>
                  {when ? ` · ${format(new Date(when), "PPP")}` : ""}
                </p>

                {kind === "total" && (
                  <>
                    <p className="text-neutral-700 text-sm">
                      Changed {his?.leaveType} from{" "}
                      <span className="font-medium text-indigo-700">
                        {his?.oldTotal}
                      </span>{" "}
                      to{" "}
                      <span className="font-medium text-indigo-700">
                        {his?.newTotal}
                      </span>
                      {" — "}
                      {his?.used ?? 0} used, {his?.newRemaining} left
                    </p>
                    {his?.belowStatutory && (
                      <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700">
                        <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                        Set below the statutory entitlement of{" "}
                        {his?.statutoryEntitlement} at the time
                      </p>
                    )}
                  </>
                )}

                {kind === "booking" && (
                  <p className="text-neutral-700 text-sm">
                    Booked{" "}
                    <span className="font-medium text-indigo-700">
                      {his?.leaveDays} day{his?.leaveDays === 1 ? "" : "s"}
                    </span>{" "}
                    of {his?.leaveType}
                    {his?.leaveYear ? ` in ${his.leaveYear}` : ""}
                  </p>
                )}

                {kind === "visibility" && (
                  <p className="text-neutral-700 text-sm">
                    {his?.isHide ? "Hid" : "Showed"} {his?.leaveType} on the
                    employee&apos;s own summary
                  </p>
                )}

                {kind === "lifecycle" && (
                  <p className="text-neutral-700 text-sm">
                    {his?.action === "restored" ? "Restored" : "Removed"}{" "}
                    {his?.leaveType}
                  </p>
                )}

                {kind === "unknown" && (
                  <p className="text-neutral-700 text-sm">
                    Changed {his?.leaveType || "an entitlement"}
                  </p>
                )}

                {/* Required on every total change, so it is worth reading. */}
                {his?.reason && (
                  <p className="mt-1 text-sm text-neutral-600">
                    <span className="text-neutral-400">Reason: </span>
                    {his.reason}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {!isAtBottom && (
        <Button
          size="icon"
          variant="outline"
          className="absolute bottom-4 left-4 rounded-full"
          onClick={scrollToBottom}
        >
          <ArrowDownIcon className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
};

export default Leavehistory;
